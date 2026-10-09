use bun_lint_oxlint::ast_util::{get_inner_expression, is_new_expression};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::FxHashMap;

/// Disallow invalid options in `fetch()` and `new Request()`.
pub struct NoInvalidFetchOptions;

const NO_INVALID_FETCH_OPTIONS: Message = Message::new("", "\"body\" is not allowed when method is \"{{method}}\"");

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum Method {
    Get,
    Head,
    /// Another one, or one that cannot be told.
    Unknown,
}

impl Method {
    fn of(name: &[u8]) -> Method {
        match name {
            b"GET" => Method::Get,
            b"HEAD" => Method::Head,
            _ => Method::Unknown,
        }
    }

    fn of_any_case(name: &[u8]) -> Method {
        if name.eq_ignore_ascii_case(b"GET") {
            Method::Get
        } else if name.eq_ignore_ascii_case(b"HEAD") {
            Method::Head
        } else {
            Method::Unknown
        }
    }

    fn of_template(template: Template) -> Method {
        match template.quasi_count() {
            1 => Method::of_any_case(template.raw(0)),
            _ => Method::Unknown,
        }
    }
}

/// What a variable says about the method, as the value of `method` (`false`) and as the `E` of `method: E.A` (`true`).
/// `None`: nothing, the method is what it was before.
type Known<'a> = FxHashMap<(Symbol<'a>, bool), Option<Method>>;

impl Rule for NoInvalidFetchOptions {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "no-invalid-fetch-options", Kind::Problem);
    type State<'a> = Known<'a>;

    fn new(_: &Options) -> Self {
        NoInvalidFetchOptions
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Known<'a> {
        if !file.mentions("body") {
            return Known::default();
        }
        if file.mentions("fetch") {
            on.exprs([ExprTag::Call], |_, e, cx| {
                if let Some(call) = e.as_call()
                    && get_inner_expression(call.callee()).is_ident("fetch")
                {
                    check(call, cx);
                }
            });
        }
        if file.mentions("Request") {
            on.exprs([ExprTag::New], |_, e, cx| {
                if let ExprKind::New(new) = e.kind()
                    && is_new_expression(new, &["Request"], Some(2), None)
                {
                    check(new, cx);
                }
            });
        }
        Known::default()
    }
}

fn check<'a>(call: Call<'a>, cx: &mut Cx<'a, NoInvalidFetchOptions>) {
    if let Some(options) = call.args().get(1)
        && let ExprKind::Object(properties) = options.kind()
        && !options.is_parenthesized()
        && let Some((method, body)) = is_invalid_fetch_options(properties, &mut cx.state)
    {
        cx.report(body, NO_INVALID_FETCH_OPTIONS).data("method", if method == Method::Get { "GET" } else { "HEAD" });
    }
}

fn is_invalid_fetch_options<'a>(properties: List<'a, Prop<'a>>, known: &mut Known<'a>) -> Option<(Method, Span)> {
    let (mut body, mut method) = (None, Method::Get);
    for property in properties {
        if property.kind() == PropKind::Spread {
            return None;
        }
        let (Some(key), Some(value)) = (property.key(), property.value()) else {
            continue;
        };
        let KeyKind::Ident(name) = key.kind() else {
            continue;
        };
        if name.is("body") {
            body = (!is_null_or_undefined(value)).then(|| key.span(value.file()));
        } else if name.is("method") {
            method = method_of(value, known).unwrap_or(method);
        }
    }
    body.filter(|_| method != Method::Unknown).map(|body| (method, body))
}

fn is_null_or_undefined(e: Expr) -> bool {
    !e.is_parenthesized() && (e.tag() == ExprTag::Null || e.is_ident("undefined") || e.unary_op() == Some(UnOp::Void))
}

/// `None`: the method is what it was before.
fn method_of<'a>(value: Expr<'a>, known: &mut Known<'a>) -> Option<Method> {
    if value.is_parenthesized() {
        return Some(Method::Unknown);
    }
    let (variable, is_object) = match value.kind() {
        ExprKind::String(name) => return Some(Method::of_any_case(name.bytes())),
        ExprKind::Template(template) => return Some(Method::of_template(template)),
        ExprKind::Dot { obj, .. } if !value.is_private_member() && !value.is_chain_root() => (obj, true),
        _ => (value, false),
    };
    if variable.tag() != ExprTag::Ident || variable.is_parenthesized() {
        return Some(Method::Unknown);
    }
    let Some(symbol) = variable.symbol().filter(|it| !it.is_implicit_arguments()) else {
        return Some(Method::Unknown);
    };
    *known.entry((symbol, is_object)).or_insert_with(|| match is_object {
        true => method_of_enum(symbol),
        false => method_of_variable(symbol),
    })
}

/// The first string that a member of the enum is initialized with, whichever member is used.
fn method_of_enum(symbol: Symbol) -> Option<Method> {
    if !symbol.declarations().any(|it| matches!(it, Declaration::Enum(_))) {
        return Some(Method::Unknown);
    }
    let Some(Declaration::Enum(declaration)) = symbol.declarations().next() else {
        return None;
    };
    let initializers = declaration.members().iter().filter_map(EnumMember::init);
    let first_string = initializers.filter(|it| !it.is_parenthesized()).find_map(Expr::as_string);
    first_string.map(|it| Method::of(it.bytes()))
}

fn method_of_variable(symbol: Symbol) -> Option<Method> {
    match symbol.declarations().next()? {
        declaration @ Declaration::Var(_) if !declaration.is_catch_parameter() => {
            let Some(Node::VarDecl(declarator)) = declaration.node() else {
                return None;
            };
            Some(match declarator.init().filter(|it| !it.is_parenthesized()).map(Expr::kind) {
                Some(ExprKind::String(name)) => Method::of_any_case(name.bytes()),
                Some(ExprKind::Template(template)) => Method::of_template(template),
                _ => Method::Unknown,
            })
        }
        Declaration::Param(pat) => {
            let param = Node::Pat(pat).ancestors().find_map(|it| match it {
                Node::Param(param) => Some(param),
                _ => None,
            })?;
            let ty = param.ty().filter(|_| !param.is_rest())?;
            if ty.is_parenthesized() {
                return Some(Method::Unknown);
            }
            match ty.kind() {
                TypeKind::Union(types) => {
                    let allows_no_body = |it: TypeNode| string_literal(it).is_some_and(|it| it != Method::Unknown);
                    (!types.iter().any(allows_no_body)).then_some(Method::Unknown)
                }
                TypeKind::StringLit(_) => string_literal(ty),
                TypeKind::NumberLit(_) | TypeKind::BigIntLit { .. } | TypeKind::BoolLit(_) => None,
                _ => Some(Method::Unknown),
            }
        }
        _ => None,
    }
}

/// The method that the type `"get"` names. Nothing for `` `get` ``.
fn string_literal(ty: TypeNode) -> Option<Method> {
    match ty.kind() {
        TypeKind::StringLit(name) if !ty.is_parenthesized() && !ty.text().starts_with(b"`") => {
            Some(Method::of_any_case(name.bytes()))
        }
        _ => None,
    }
}

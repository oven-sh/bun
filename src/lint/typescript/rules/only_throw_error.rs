use bun_lint::prelude::*;
use bun_lint::types::TypeFlags;
use bun_lint::types::tsutils::is_thenable;
use bun_lint::types::utils::{
    TypeOrValueSpecifier, is_error_like, is_type_any_type, is_type_unknown_type, parse_catch_call,
    parse_then_call, parse_type_or_value_specifiers, type_matches_some_specifier,
};

/// Disallow throwing non-`Error` values as exceptions.
pub struct OnlyThrowError {
    allow: Vec<TypeOrValueSpecifier>,
    allow_rethrowing: bool,
    allow_throwing_any: bool,
    allow_throwing_unknown: bool,
}

const OBJECT: Message = Message::new("object", "Expected an error object to be thrown.");
const UNDEF: Message = Message::new("undef", "Do not throw undefined.");

fn is_rethrown_error(node: Expr) -> bool {
    if node.as_ident().is_none() {
        return false;
    }
    let Some(variable) = node.symbol() else {
        return false;
    };
    let definitions = || variable.declarations().filter(|def| def.kind().is_some());
    let variable_definitions = definitions().filter(|def| def.kind() != Some(DeclarationKind::Type));
    if variable_definitions.count() != 1 {
        return false;
    }
    let Some(def) = definitions().next() else {
        return false;
    };

    // try { /* ... */ } catch (x) { throw x; }
    if def.is_catch_parameter() {
        return true;
    }

    // promise.catch(x => { throw x; })
    // promise.then(onFulfilled, x => { throw x; })
    let (Declaration::Param(name), Some(Node::Func(func))) = (def, def.node()) else {
        return false;
    };
    let is_first_parameter = func
        .params()
        .first()
        .is_some_and(|first| first.pat() == name && first.default().is_none() && !first.is_rest());
    if !func.is_arrow() || !is_first_parameter {
        return false;
    }
    let Node::Expr(arrow) = func.owner() else {
        return false;
    };
    let Node::Expr(call_expression) = arrow.parent() else {
        return false;
    };
    let handling = match parse_catch_call(call_expression) {
        Some(call) => Some((call.object, call.on_rejected)),
        None => parse_then_call(call_expression).map(|call| (call.object, call.on_rejected)),
    };
    let Some((object, on_rejected)) = handling else {
        return false;
    };
    on_rejected == Some(arrow) && is_thenable(node.file(), object)
}

impl OnlyThrowError {
    fn check_throw_argument<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::Throw(node) = statement.kind() else {
            return;
        };
        if self.allow_rethrowing && is_rethrown_error(node) {
            return;
        }
        let ty = node.ty();
        if ty.is_unresolved() || type_matches_some_specifier(ty, &self.allow) {
            return;
        }
        if ty.has_flags(TypeFlags::UNDEFINED) {
            cx.report(node, UNDEF);
            return;
        }
        if self.allow_throwing_any && is_type_any_type(ty) {
            return;
        }
        if self.allow_throwing_unknown && is_type_unknown_type(ty) {
            return;
        }
        if is_error_like(ty) {
            return;
        }
        cx.report(node, OBJECT);
    }
}

impl Rule for OnlyThrowError {
    const META: Meta = Meta::typescript("only-throw-error", Kind::Problem)
        .presets(Presets::RECOMMENDED_TYPE_CHECKED)
        .requires_types()
        .extends_base_rule("no-throw-literal");
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        OnlyThrowError {
            allow: parse_type_or_value_specifiers(options.array("allow")),
            allow_rethrowing: options.bool_or("allowRethrowing", true),
            allow_throwing_any: options.bool_or("allowThrowingAny", true),
            allow_throwing_unknown: options.bool_or("allowThrowingUnknown", true),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts([StmtTag::Throw], Self::check_throw_argument);
    }
}

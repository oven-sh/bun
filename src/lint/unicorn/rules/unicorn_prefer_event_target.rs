use bun_lint_oxlint::ast_util::{get_declaration_of_variable, get_inner_expression, is_import_from_module, static_string};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prefer `EventTarget` over `EventEmitter`.
pub struct PreferEventTarget;

const PREFER_EVENT_TARGET: Message = Message::new("", "Prefer `EventTarget` over `EventEmitter`.");

const IGNORED_PACKAGES: [&str; 2] = ["@angular/core", "eventemitter3"];

/// A string or a template without substitutions that names one of [`IGNORED_PACKAGES`].
fn is_ignored_package(source: Expr) -> bool {
    static_string(source).is_some_and(|it| it.is_any(&IGNORED_PACKAGES))
}

/// `require("eventemitter3")`, `await import("eventemitter3")`
fn is_await_import_or_require_from_ignored_packages(e: Expr) -> bool {
    match get_inner_expression(e).kind() {
        ExprKind::Call(call) => {
            call.chain() == Chain::No
                && call.args().len() == 1
                && get_inner_expression(call.callee()).is_ident("require")
                && call.args().first().is_some_and(|it| !it.is_parenthesized() && is_ignored_package(it))
        }
        ExprKind::Await(argument) => match get_inner_expression(argument).kind() {
            ExprKind::ImportCall { args } => args.first().map(get_inner_expression).is_some_and(is_ignored_package),
            _ => false,
        },
        _ => false,
    }
}

fn is_event_emitter_from_ignored_package(ident: Expr) -> bool {
    if IGNORED_PACKAGES.iter().any(|it| is_import_from_module(ident, it)) {
        return true;
    }
    let declaration = get_declaration_of_variable(ident).filter(|it| !it.is_catch_parameter());
    let Some(Node::VarDecl(declarator)) = declaration.and_then(Declaration::node) else {
        return false;
    };
    let Some(init) = declarator.init() else {
        return false;
    };
    match declarator.pat().kind() {
        // `const { EventEmitter } = require("eventemitter3")`
        PatKind::Object(properties) => {
            let is_event_emitter = |property: PatProp| {
                property.key().is_some_and(|it| !it.is_private() && it.is("EventEmitter"))
                    && property.value().as_ident().is_some_and(|it| it.is("EventEmitter"))
            };
            properties.iter().any(is_event_emitter) && is_await_import_or_require_from_ignored_packages(init)
        }
        // `const EventEmitter = require("eventemitter3").EventEmitter`
        PatKind::Ident(_) => match get_inner_expression(init).kind() {
            ExprKind::Dot { obj, name, chain } => {
                chain == Chain::No
                    && name.name().is("EventEmitter")
                    && is_await_import_or_require_from_ignored_packages(obj)
            }
            _ => false,
        },
        _ => false,
    }
}

fn check<'a>(ident: Option<Expr<'a>>, cx: &Cx<'a, PreferEventTarget>) {
    if let Some(ident) = ident.filter(|it| it.is_ident("EventEmitter") && !it.is_parenthesized())
        && !is_event_emitter_from_ignored_package(ident)
    {
        cx.report(ident, PREFER_EVENT_TARGET);
    }
}

impl Rule for PreferEventTarget {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "prefer-event-target", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferEventTarget
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("EventEmitter") {
            return;
        }
        on.classes(|_, class, cx| check(class.extends(), cx));
        on.exprs([ExprTag::New], |_, e, cx| check(e.callee(), cx));
    }
}

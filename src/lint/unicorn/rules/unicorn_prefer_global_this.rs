use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prefer `globalThis` over environment-specific global aliases like `window`, `self`, and `global`.
pub struct PreferGlobalThis;

const PREFER_GLOBAL_THIS: Message = Message::new(
    "",
    "Prefer `globalThis` over environment-specific global aliases like `window`, `self`, and `global`.",
);
const REPLACE_ALIAS: Message = Message::new("", "Replace the alias with `globalThis`.");

const ALIASES: [&str; 3] = ["window", "self", "global"];

const WEB_WORKER_SPECIFIC_APIS: &[&str] = &[
    "addEventListener", "removeEventListener", "dispatchEvent", "self", "location", "navigator", "onerror",
    "onlanguagechange", "onoffline", "ononline", "onrejectionhandled", "onunhandledrejection", "name", "postMessage",
    "onconnect",
];

const WINDOW_SPECIFIC_APIS: &[&str] = &[
    "name", "locationbar", "menubar", "personalbar", "scrollbars", "statusbar", "toolbar", "status", "close", "closed",
    "stop", "focus", "blur", "frames", "length", "top", "opener", "parent", "frameElement", "open",
    "originAgentCluster", "postMessage", "onresize", "onblur", "onfocus", "onload", "onscroll", "onscrollend",
    "onwheel", "onbeforeunload", "onmessage", "onmessageerror", "onpagehide", "onpagereveal", "onpageshow",
    "onpageswap", "onunload", "addEventListener", "removeEventListener", "dispatchEvent", "event", "screen",
    "visualViewport", "moveTo", "moveBy", "resizeTo", "resizeBy", "innerWidth", "innerHeight", "outerWidth",
    "outerHeight", "scrollX", "pageXOffset", "scrollY", "pageYOffset", "scroll", "scrollTo", "scrollBy", "screenX",
    "screenLeft", "screenY", "screenTop", "screenWidth", "screenHeight", "devicePixelRatio",
];

const WINDOW_SPECIFIC_EVENTS: &[&str] = &[
    "resize", "blur", "focus", "load", "scroll", "scrollend", "wheel", "beforeunload", "message", "messageerror",
    "pagehide", "pagereveal", "pageshow", "pageswap", "unload",
];

/// `window[a]`, and the properties that only `window` or only the global object of a worker has.
fn is_allowed(alias: &str, ident: Expr) -> bool {
    let Node::Expr(member) = ident.parent() else {
        return false;
    };
    if ident.is_parenthesized() || member.object() != Some(ident) {
        return false;
    }
    let Some(property) = member.member_name().filter(|_| !member.is_private_member()) else {
        return member.tag() == ExprTag::Index;
    };
    let property = property.name();
    match alias {
        "self" => property.is_any(WEB_WORKER_SPECIFIC_APIS),
        "window" if !property.is_any(WINDOW_SPECIFIC_APIS) => false,
        // Where it is called: only for the events of `window`.
        "window" if property.is_any(&["addEventListener", "removeEventListener", "dispatchEvent"]) => {
            let call = member.parent().as_expr().filter(|_| !member.is_parenthesized() && !member.is_chain_root());
            call.and_then(Expr::as_call).filter(|it| it.callee() == member).is_none_or(|call| {
                (call.args().first().filter(|it| !it.is_parenthesized()).and_then(Expr::as_string))
                    .is_some_and(|it| it.is_any(WINDOW_SPECIFIC_EVENTS))
            })
        }
        "window" => true,
        _ => false,
    }
}

impl Rule for PreferGlobalThis {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "prefer-global-this", Kind::Suggestion).has_suggestions();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferGlobalThis
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions_any(&ALIASES) {
            return;
        }
        on.finish(|_, cx| {
            let file = cx.file();
            for alias in ALIASES.into_iter().filter(|it| file.mentions(it)) {
                for reference in file.unresolved_references_to(alias.as_bytes()).filter(|it| !it.is_jsx_pragma()) {
                    let ident = reference.expr();
                    if ident.is_some_and(|it| is_allowed(alias, it)) {
                        continue;
                    }
                    cx.report(reference.span(), PREFER_GLOBAL_THIS).suggest(REPLACE_ALIAS, |fixer| {
                        // `typeof window` does not throw where there is no `window`.
                        let is_typeof = ident.is_some_and(|it| {
                            !it.is_parenthesized()
                                && matches!(it.parent(), Node::Expr(parent) if parent.unary_op() == Some(UnOp::Typeof))
                        });
                        match is_typeof {
                            true => fixer.replace(reference.span(), ["globalThis.", alias].concat()),
                            false => fixer.replace(reference.span(), "globalThis"),
                        }
                    });
                }
            }
        });
    }
}

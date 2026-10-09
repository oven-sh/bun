use bun_lint::prelude::*;
use bun_lint::utils::eslint_utils::{ReferenceTracker, TraceMap};
use bun_lint_oxlint::ast_util::{
    get_declaration_of_variable, is_reference_to_global_variable, is_specific_id, static_property_name,
};
use std::borrow::Cow;

/// Disallow calling global object properties as functions.
pub struct NoObjCalls;

const UNEXPECTED_CALL: Message = Message::new("unexpectedCall", "'{{name}}' is not a function.");
const UNEXPECTED_REF_CALL: Message = Message::new(
    "unexpectedRefCall",
    "'{{name}}' is reference to '{{ref}}', which is not a function.",
);

const NOT_CALLABLE: TraceMap<'static, ()> = TraceMap::EMPTY.call(()).construct(());
const TRACE_MAP: TraceMap<'static, ()> = TraceMap::new(&[
    ("Atomics", NOT_CALLABLE),
    ("JSON", NOT_CALLABLE),
    ("Math", NOT_CALLABLE),
    ("Reflect", NOT_CALLABLE),
    ("Intl", NOT_CALLABLE),
    ("Temporal", NOT_CALLABLE),
]);

/// ESLint's `getReportNodeName`. Where that has no name, the message has JavaScript's `null` or
/// `undefined`.
fn get_report_node_name(callee: Expr<'_>) -> Cow<'_, [u8]> {
    match callee.kind() {
        ExprKind::Dot { .. } | ExprKind::Index { .. } => {
            ast_utils::get_static_property_name(callee).unwrap_or(Cow::Borrowed(b"null"))
        }
        ExprKind::Ident(name) => Cow::Borrowed(name.bytes()),
        _ => Cow::Borrowed(b"undefined"),
    }
}

/// The objects that oxlint knows.
const OXLINT_GLOBAL_OBJECTS: [&str; 5] = ["Atomics", "Intl", "JSON", "Math", "Reflect"];

/// oxlint's `global_this_member`: the `a` of `globalThis.a`.
fn global_this_member(member: Expr<'_>) -> Option<Name<'_>> {
    let (ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. }) = member.kind() else {
        return None;
    };
    static_property_name(member).filter(|_| is_specific_id(obj, "globalThis"))
}

/// oxlint's `resolve_global_binding`: the name of the global variable that `ident` has the value of, through variables
/// that are declared with nothing but a name or `globalThis.a` as their value. What a pattern declares stands for its own
/// name.
fn resolve_global_binding(mut ident: Expr<'_>) -> Option<Name<'_>> {
    // `var a = b, b = a;` has no end.
    for _ in 0..64 {
        let name = ident.as_ident()?;
        let Some(declaration) = get_declaration_of_variable(ident) else {
            return is_reference_to_global_variable(ident).then_some(name);
        };
        let Some(Node::VarDecl(declarator)) = declaration.node().filter(|_| !declaration.is_catch_parameter()) else {
            return None;
        };
        if declarator.pat().tag() != PatTag::Ident {
            return Some(name);
        }
        let init = declarator.init().filter(|it| !it.is_parenthesized())?;
        match init.kind() {
            ExprKind::Ident(next) if next != name => ident = init,
            _ if init.is_chain_root() => return None,
            _ => return global_this_member(init),
        }
    }
    None
}

impl NoObjCalls {
    fn check_as_oxlint<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(callee) = e.as_call_like().map(|it| it.callee()).filter(|it| !it.is_parenthesized()) else {
            return;
        };
        let (name, global) = match callee.as_ident() {
            Some(name) => (Some(name), resolve_global_binding(callee)),
            None => (global_this_member(callee), global_this_member(callee)),
        };
        if let (Some(name), Some(global)) = (name, global)
            && OXLINT_GLOBAL_OBJECTS.iter().any(|it| global.is(it))
        {
            cx.report(e, UNEXPECTED_CALL).data("name", name);
        }
    }

    fn check<'a>(&self, cx: &mut Cx<'a, Self>) {
        for reference in ReferenceTracker::new(cx.file()).iterate_global_references(&TRACE_MAP) {
            let (Some(call), Some(&global)) = (reference.call(), reference.path.first()) else {
                continue;
            };
            let name = get_report_node_name(call.callee());
            let message = if *name == *global.as_bytes() { UNEXPECTED_CALL } else { UNEXPECTED_REF_CALL };
            cx.report(reference.span, message).data("name", name).data("ref", global);
        }
    }
}

impl Rule for NoObjCalls {
    const META: Meta = Meta::eslint("no-obj-calls", Kind::Problem).recommended();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoObjCalls
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if file.language().is_oxlint {
            if OXLINT_GLOBAL_OBJECTS.iter().any(|it| file.mentions(it)) {
                on.exprs([ExprTag::Call, ExprTag::New], Self::check_as_oxlint);
            }
            return;
        }
        if file.has_exprs([ExprTag::Call, ExprTag::New]) {
            on.finish(Self::check);
        }
    }
}

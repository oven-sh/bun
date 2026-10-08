use bun_lint::prelude::*;
use bun_lint::utils::eslint_utils::{ReferenceTracker, TraceMap};
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

impl NoObjCalls {
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
        if file.has_exprs([ExprTag::Call, ExprTag::New]) {
            on.finish(Self::check);
        }
    }
}

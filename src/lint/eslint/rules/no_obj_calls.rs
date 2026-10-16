use bun_lint::prelude::*;
use bun_lint::semantic::DeclarationKinds;
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

/// The global variables that `ReferenceTracker` starts from: those of `TRACE_MAP`, and the global object.
const TRACKED_FROM: [&str; 10] =
    ["Atomics", "JSON", "Math", "Reflect", "Intl", "Temporal", "global", "globalThis", "self", "window"];

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

/// What is asked of every call with a configuration of oxlint.
pub struct Oxlint<'a> {
    /// `OXLINT_GLOBAL_OBJECTS`
    objects: [Name<'a>; 5],
    /// A bit for the last bits of the number of each of them.
    numbers: u64,
    mentions_global_this: bool,
}

impl<'a> Oxlint<'a> {
    /// Whether a call of `callee` can be one of an object. Under another name only a variable stands for one of them.
    #[inline]
    fn may_be_object(&self, callee: Expr<'a>) -> bool {
        match callee.as_ident() {
            Some(name) => {
                self.numbers >> (name.atom().0 % 64) & 1 != 0
                    || callee.symbol().is_some_and(|it| it.declaration_kinds().contains(DeclarationKinds::VARIABLE))
            }
            None => self.mentions_global_this,
        }
    }

    /// oxlint's `global_this_member`: the `a` of `globalThis.a`.
    fn global_this_member(&self, member: Expr<'a>) -> Option<Name<'a>> {
        if !self.mentions_global_this || !is_specific_id(member.object()?, "globalThis") {
            return None;
        }
        static_property_name(member)
    }

    /// oxlint's `resolve_global_binding`: the name of the global variable that `ident` has the value of, through variables
    /// that are declared with nothing but a name or `globalThis.a` as their value. What a pattern declares stands for its own
    /// name. Of the global variables only `objects` are told.
    fn resolve_global_binding(&self, mut ident: Expr<'a>) -> Option<Name<'a>> {
        // `var a = b, b = a;` has no end.
        let mut seen = rustc_hash::FxHashSet::default();
        loop {
            let name = ident.as_ident()?;
            let Some(declaration) = get_declaration_of_variable(ident) else {
                return (self.objects.contains(&name) && is_reference_to_global_variable(ident)).then_some(name);
            };
            if !matches!(declaration, Declaration::Var(_)) || declaration.is_catch_parameter() {
                return None;
            }
            let Some(Node::VarDecl(declarator)) = declaration.node() else {
                return None;
            };
            if declarator.pat().tag() != PatTag::Ident {
                return Some(name);
            }
            let init = declarator.init().filter(|it| !it.is_parenthesized())?;
            match init.as_ident() {
                Some(next) if next != name => {
                    if !seen.insert(init) {
                        return None;
                    }
                    ident = init;
                }
                _ if init.is_chain_root() => return None,
                _ => return self.global_this_member(init),
            }
        }
    }
}

impl NoObjCalls {
    #[inline(never)]
    fn check_as_oxlint<'a>(&self, (e, callee): (Expr<'a>, Expr<'a>), cx: &mut Cx<'a, Self>) {
        let Some(oxlint) = &cx.state else {
            return;
        };
        let found = match callee.as_ident() {
            Some(name) if !callee.is_parenthesized() => oxlint.resolve_global_binding(callee).map(|global| (name, global)),
            Some(_) => None,
            None => oxlint.global_this_member(callee).filter(|_| !callee.is_parenthesized()).map(|name| (name, name)),
        };
        if let Some((name, global)) = found
            && oxlint.objects.contains(&global)
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
    const ON: On = On::new().exprs(&[ExprTag::Call, ExprTag::New]).finish();
    /// `None` with a configuration of ESLint.
    type State<'a> = Option<Oxlint<'a>>;

    fn new(_: &Options) -> Self {
        NoObjCalls
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        if !file.language().is_oxlint {
            return On::new().finish();
        }
        On::new().exprs(&[ExprTag::Call, ExprTag::New])
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        if file.language().is_oxlint {
            return file.mentions_any(&OXLINT_GLOBAL_OBJECTS).then(|| {
                Some(Oxlint {
                    objects: OXLINT_GLOBAL_OBJECTS.map(|it| file.name_of(it)),
                    numbers: (OXLINT_GLOBAL_OBJECTS.iter())
                        .fold(0, |numbers, it| numbers | 1 << (file.name_of(it).atom().0 % 64)),
                    mentions_global_this: file.mentions("globalThis"),
                })
            });
        }
        (file.has_exprs([ExprTag::Call, ExprTag::New]) && file.mentions_any(&TRACKED_FROM)).then_some(None)
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let (Some(call), Some(oxlint)) = (e.as_call_like(), &cx.state)
            && oxlint.may_be_object(call.callee())
        {
            self.check_as_oxlint((e, call.callee()), cx);
        }
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        self.check(cx);
    }
}

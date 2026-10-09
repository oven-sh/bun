use bun_lint_oxlint::ast_util::{get_inner_expression, static_property_name};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow defining a `then` property.
pub struct NoThenable;

const OBJECT: Message = Message::new("", "Do not add `then` to an object.");
const EXPORT: Message = Message::new("", "Do not export `then`.");
const CLASS: Message = Message::new("", "Do not add `then` to a class.");

impl Rule for NoThenable {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "no-thenable", Kind::Problem);
    /// The name `then`.
    type State<'a> = Option<Name<'a>>;

    fn new(_: &Options) -> Self {
        NoThenable
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Option<Name<'a>> {
        if !file.mentions("then") {
            return None;
        }
        on.props(|_, prop, cx| {
            if let Some(then) = cx.state
                && prop.kind() != PropKind::Spread
                && !prop.is_jsx_attribute()
                && let Some(span) = contains_then(prop.key(), then, cx.file())
                && matches!(prop.parent(), Node::Expr(object) if !object.is_assignment_target())
            {
                cx.report(span, OBJECT);
            }
        });
        on.members(|_, member, cx| {
            if let Some(then) = cx.state
                && let Some(span) = contains_then(member.key(), then, cx.file())
                && !member.is_signature()
                && !member.flags().contains(Flags::ACCESSOR)
            {
                cx.report(span, CLASS);
            }
        });
        on.stmts([StmtTag::Var, StmtTag::Fn, StmtTag::Class], |_, stmt, cx| {
            let Some(then) = cx.state.filter(|_| !stmt.modifiers().is_empty()) else {
                return;
            };
            if !stmt.is_exported() || stmt.is_default_export() {
                return;
            }
            let name = match stmt.kind() {
                StmtKind::Var(declarations) => {
                    for declaration in declarations {
                        declaration.pat().for_each_binding(&mut |pat| {
                            if pat.as_ident() == Some(then) {
                                cx.report(pat, EXPORT);
                            }
                        });
                    }
                    None
                }
                StmtKind::Fn(func) => func.name(),
                StmtKind::Class(class) => class.name(),
                _ => None,
            };
            if let Some(name) = name.filter(|it| it.name() == then) {
                cx.report(name, EXPORT);
            }
        });
        on.export_specs(|_, spec, cx| {
            if Some(spec.exported().name()) == cx.state {
                cx.report(spec.exported(), EXPORT);
            }
        });
        if file.mentions_any(&["defineProperty", "fromEntries"]) {
            on.exprs([ExprTag::Call], |_, e, cx| {
                if let (Some(call), Some(then)) = (e.as_call(), cx.state) {
                    check_call_expression(call, then, cx);
                }
            });
        }
        on.exprs([ExprTag::Assign], |_, e, cx| {
            let (Some(target), Some(then)) = (e.left(), cx.state) else {
                return;
            };
            let span = match target.kind() {
                ExprKind::Dot { name, .. } => (name.name() == then).then(|| target.span()),
                ExprKind::Index { index, .. } => check_expression(index, then),
                _ => None,
            };
            // Not the default value in a pattern.
            if let Some(span) = span.filter(|_| !e.is_assignment_target()) {
                cx.report(span, CLASS);
            }
        });
        Some(file.name_of("then"))
    }
}

fn check_call_expression<'a>(call: Call<'a>, then: Name<'a>, cx: &Cx<'a, NoThenable>) {
    let (callee, args) = (call.callee(), call.args());
    if call.is_optional() || callee.is_optional() || callee.is_parenthesized() {
        return;
    }
    let (Some(method), Some(object), Some(first)) =
        (static_property_name(callee), callee.object().and_then(|it| get_inner_expression(it).as_ident()), args.first())
    else {
        return;
    };
    if method.is("defineProperty") && object.is_any(&["Reflect", "Object"]) {
        if args.len() >= 3
            && first.tag() != ExprTag::Spread
            && let Some(span) = args.get(1).and_then(|it| check_expression(it, then))
        {
            cx.report(span, OBJECT);
        }
    } else if method.is("fromEntries")
        && object.is("Object")
        && args.len() == 1
        && !first.is_parenthesized()
        && let ExprKind::Array(entries) = first.kind()
    {
        for entry in entries.iter().filter(|it| !it.is_parenthesized()) {
            if let ExprKind::Array(entry) = entry.kind()
                && let Some(span) = entry.first().and_then(|it| check_expression(it, then))
            {
                cx.report(span, OBJECT);
            }
        }
    }
}

/// Where the string `then` is written that `e` is, or that the variable `e` is initialized with.
fn check_expression<'a>(e: Expr<'a>, then: Name<'a>) -> Option<Span> {
    if e.is_parenthesized() {
        return None;
    }
    match e.kind() {
        ExprKind::String(value) => (value == then).then(|| e.span()),
        ExprKind::Template(template) => (template.as_static()? == then).then(|| e.span()),
        ExprKind::Ident(_) => {
            let declaration = e.symbol()?.declarations().next().filter(|it| !it.is_catch_parameter())?;
            let Node::VarDecl(declarator) = declaration.node()? else {
                return None;
            };
            let init = declarator.init().filter(|it| !it.is_parenthesized())?;
            (init.as_string()? == then).then(|| init.span())
        }
        _ => None,
    }
}

fn contains_then<'a>(key: Option<Key<'a>>, then: Name<'a>, file: &File<'a>) -> Option<Span> {
    let key = key?;
    match key.kind() {
        KeyKind::Ident(name) | KeyKind::String(name) => (name == then).then(|| key.span(file)),
        KeyKind::ComputedString(name) => (name == then).then(|| key.inner_span(file)),
        KeyKind::Computed(e) => check_expression(e, then),
        _ => None,
    }
}

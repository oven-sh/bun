use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow a ref that gets a value on every render: in the body of a component, or in an effect that does only that.
///
/// See "Do not write or read `ref.current` during rendering" in React's reference of `useRef`, and `useEffectEvent`.
pub struct ReactNoLatestValueRef;

const DURING_RENDER: Message = Message::new(
    "duringRender",
    "`{{name}}.current` is set while the component renders. React can render a component without showing the result, and more than once.",
);
const IN_EFFECT: Message = Message::new(
    "inEffect",
    "This effect only copies a value into `{{name}}.current` after a render. A function from `useEffectEvent()` sees the latest values without a ref.",
);

/// `name()`, `React.name()`
fn is_call_of(e: Expr, names: &[&str]) -> bool {
    e.as_call().is_some_and(|call| match call.callee().kind() {
        ExprKind::Ident(name) => name.is_any(names),
        ExprKind::Dot { name, .. } => name.name().is_any(names),
        _ => false,
    })
}

/// The `a` of `a.current = value`, and the `const a = useRef(..)` that declares it.
fn assigned_ref(e: Expr<'_>) -> Option<(Expr<'_>, VarDecl<'_>)> {
    let ExprKind::Assign { op: None, target, .. } = e.kind() else {
        return None;
    };
    let ExprKind::Dot { obj, name, .. } = target.kind() else {
        return None;
    };
    let declared = obj.symbol().filter(|_| name.name().is("current"))?.declarations().next()?;
    match declared.node()? {
        Node::VarDecl(declaration) if declaration.init().is_some_and(|it| is_call_of(it, &["useRef"])) => {
            Some((obj, declaration))
        }
        _ => None,
    }
}

/// The expression that a statement is.
fn expression_of(statement: Stmt<'_>) -> Option<Expr<'_>> {
    match statement.kind() {
        StmtKind::Expr(e) => Some(e),
        _ => None,
    }
}

impl Rule for ReactNoLatestValueRef {
    const META: Meta = Meta::plugin(Plugin::Bun, "react-no-latest-value-ref", Kind::Problem);
    const ON: On = On::new().exprs(&[ExprTag::Assign, ExprTag::Call]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        ReactNoLatestValueRef
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !file.mentions("useRef") || !file.mentions("current") {
            return None;
        }
        Some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match e.tag() {
            // A statement of the function that has the ref, and in nothing else: not under a condition.
            ExprTag::Assign => {
                if let Node::Stmt(statement) = e.parent()
                    && statement.tag() == StmtTag::Expr
                    && let Node::Func(func) = statement.parent()
                    && let Some((name, declaration)) = assigned_ref(e)
                    && Node::VarDecl(declaration).enclosing_function() == Some(func)
                {
                    cx.report(e, DURING_RENDER).data("name", name.text());
                }
            }
            ExprTag::Call => self.call(e, cx),
            _ => {}
        }
    }
}

impl ReactNoLatestValueRef {
    fn call<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if !is_call_of(e, &["useEffect", "useLayoutEffect", "useInsertionEffect"]) {
            return;
        }
        let Some(effect) = e.as_call().and_then(|it| it.args().first()).and_then(Expr::as_fn) else {
            return;
        };
        let assignments: Option<Vec<_>> = match effect.body() {
            FnBody::Expr(body) => assigned_ref(body).map(|it| vec![(body, it.0)]),
            FnBody::Block(statements) if !statements.is_empty() => {
                let expressions = statements.iter().map(expression_of);
                expressions.map(|it| it.and_then(|e| Some((e, assigned_ref(e)?.0)))).collect()
            }
            _ => None,
        };
        for (assignment, name) in assignments.into_iter().flatten() {
            cx.report(assignment, IN_EFFECT).data("name", name.text());
        }
    }
}

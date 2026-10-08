use bun_lint::prelude::*;

/// Disallow `require` statements except in import statements.
pub struct NoVarRequires {
    allow: Vec<Regex>,
}

const NO_VAR_REQS: Message =
    Message::new("noVarReqs", "Require statement not part of import statement.");

impl NoVarRequires {
    fn check<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Call(call) = e.kind() else {
            return;
        };
        let callee = call.callee();
        if !callee.is_ident("require") || callee.symbol().is_some() {
            return;
        }
        let is_used = match e.parent() {
            Node::VarDecl(_) => true,
            Node::Expr(parent) => matches!(
                parent.kind(),
                ExprKind::Call(_)
                    | ExprKind::New(_)
                    | ExprKind::Dot { .. }
                    | ExprKind::Index { .. }
                    | ExprKind::As { .. }
                    | ExprKind::AsConst(_)
            ),
            _ => false,
        };
        if !is_used {
            return;
        }
        let path = call.args().first().and_then(|argument| match argument.kind() {
            ExprKind::String(value) => Some(value),
            ExprKind::Template(template) => template.as_static(),
            _ => None,
        });
        if path.is_some_and(|path| self.allow.iter().any(|pattern| pattern.test(path.bytes()))) {
            return;
        }
        // Upstream looks `require` up by its name alone, so a type of that name counts too.
        if Node::Expr(e).scope().resolve("require").is_none() {
            cx.report(e, NO_VAR_REQS);
        }
    }
}

impl Rule for NoVarRequires {
    const META: Meta = Meta::typescript("no-var-requires", Kind::Problem).deprecated();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoVarRequires {
            allow: (options.object(0).strings("allow").into_iter())
                .filter_map(|pattern| Regex::new(pattern, "u").ok())
                .collect(),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("require") {
            return;
        }
        on.exprs([ExprTag::Call], Self::check);
    }
}

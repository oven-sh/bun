use bun_lint::prelude::*;

/// Disallow synchronous methods.
pub struct NoSync {
    allows_at_root_level: bool,
}

const NO_SYNC: Message = Message::new("noSync", "Unexpected sync method: '{{propertyName}}'.");

impl NoSync {
    /// Whether a `MemberExpression` that is `node` is looked at: with `allowAtRootLevel`, only
    /// inside a function.
    fn applies(&self, node: Node) -> bool {
        !self.allows_at_root_level
            || node
                .ancestors()
                .any(|it| matches!(it, Node::Func(func) if ast_utils::is_function_with_body(func)))
    }

    fn check<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let name = match e.kind() {
            ExprKind::Dot { name, .. } => name.bytes(),
            ExprKind::Index { index, .. } => match index.as_ident() {
                Some(name) => name.bytes(),
                None => return,
            },
            _ => return,
        };
        if name.ends_with(b"Sync") && ast_utils::is_member_expression(e) && self.applies(e.into()) {
            cx.report(e, NO_SYNC).data("propertyName", name.strip_prefix(b"#").unwrap_or(name));
        }
    }

    /// `implements a.b`, and `extends a.b` of an interface: ESTree has a `MemberExpression` there.
    fn check_heritage<'a>(&self, ty: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        let TypeKind::Ref { name, .. } = ty.kind() else {
            return;
        };
        let Some(first) = name.first() else {
            return;
        };
        for part in name.parts().skip(1) {
            if part.bytes().ends_with(b"Sync") && self.applies(ty.into()) {
                cx.report(first.span().to(part.span()), NO_SYNC).data("propertyName", part);
            }
        }
    }
}

impl Rule for NoSync {
    const META: Meta = Meta::eslint("no-sync", Kind::Suggestion).deprecated();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoSync {
            allows_at_root_level: options.object(0).bool_or("allowAtRootLevel", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        on.exprs([ExprTag::Dot, ExprTag::Index], Self::check);
        if !file.is_javascript() {
            on.classes(|rule, class, cx| {
                for ty in class.implements() {
                    rule.check_heritage(ty, cx);
                }
            });
            on.stmts([StmtTag::Interface], |rule, statement, cx| {
                if let StmtKind::Interface(interface) = statement.kind() {
                    for ty in interface.extends() {
                        rule.check_heritage(ty, cx);
                    }
                }
            });
        }
    }
}

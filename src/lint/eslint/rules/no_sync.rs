use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Disallow synchronous methods.
pub struct NoSync {
    allows_at_root_level: bool,
}

const NO_SYNC: Message = Message::new("noSync", "Unexpected sync method: '{{propertyName}}'.");

impl NoSync {
    /// Whether a `MemberExpression` that is `node` is looked at: with `allowAtRootLevel`, only
    /// inside a function.
    fn applies<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) -> bool {
        let is_function = |it: Node| matches!(it, Node::Func(func) if ast_utils::is_function_with_body(func));
        !self.allows_at_root_level || cx.state.find(node, |_, it| is_function(it).then_some(())).is_some()
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
        if name.ends_with(b"Sync") && ast_utils::is_member_expression(e) && self.applies(e.into(), cx) {
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
            if part.bytes().ends_with(b"Sync") && self.applies(ty.into(), cx) {
                cx.report(first.span().to(part.span()), NO_SYNC).data("propertyName", part);
            }
        }
    }
}

impl Rule for NoSync {
    const META: Meta = Meta::eslint("no-sync", Kind::Suggestion).deprecated();
    const ON: On = On::new()
        .exprs(&[ExprTag::Dot, ExprTag::Index])
        .classes()
        .stmts(&[StmtTag::Interface]);
    /// That a node is in a function.
    type State<'a> = AncestorMemo<'a, ()>;

    fn new(options: &Options) -> Self {
        NoSync {
            allows_at_root_level: options.object(0).bool_or("allowAtRootLevel", false),
        }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let mut on = On::new().exprs(&[ExprTag::Dot, ExprTag::Index]);
        if !file.is_javascript() {
            on = on.classes().stmts(&[StmtTag::Interface]);
        }
        on
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Self::State<'a>> {
        Some(AncestorMemo::default())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        self.check(e, cx);
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if let StmtKind::Interface(interface) = statement.kind() {
            for ty in interface.extends() {
                self.check_heritage(ty, cx);
            }
        }
    }

    fn class<'a>(&self, class: Class<'a>, cx: &mut Cx<'a, Self>) {
        for ty in class.implements() {
            self.check_heritage(ty, cx);
        }
    }
}

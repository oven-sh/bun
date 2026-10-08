use bun_lint::prelude::*;

/// Disallow the use of `eval()`.
pub struct NoEval {
    allows_indirect: bool,
}

const UNEXPECTED: Message = Message::new("unexpected", "`eval` can be harmful.");

/// `e` is a member access of the property `name`.
fn is_member(e: Expr<'_>, name: &str) -> bool {
    ast_utils::is_specific_member_access(e, None, Some(name))
}

/// The identifier refers to the variable of its name in the global scope, which the configuration
/// defines or a script declares.
fn refers_to_global_variable(e: Expr<'_>) -> bool {
    let Some(reference) = e.reference() else {
        return false;
    };
    match reference.symbol() {
        Some(symbol) => symbol.scope().kind() == ScopeKind::Global,
        None => ast_utils::is_configured_global(e.file(), reference.name().bytes()),
    }
}

impl NoEval {
    /// Reports the `eval` of `object.eval` or `object["eval"]`.
    fn report_member<'a>(member: Expr<'a>, cx: &Cx<'a, Self>) {
        if !ast_utils::is_member_expression(member) {
            return;
        }
        match member.kind() {
            ExprKind::Dot { name, .. } => cx.report(name, UNEXPECTED),
            ExprKind::Index { index, .. } => cx.report(index, UNEXPECTED),
            _ => return,
        };
    }

    fn check_call<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        // `eval?.("code")` is not a direct call.
        if let Some(call) = e.as_call()
            && call.callee().is_ident("eval")
            && !(self.allows_indirect && call.is_optional())
        {
            cx.report(call.callee(), UNEXPECTED);
        }
    }

    /// `eval` that is not called, and `eval` as a property of the global object.
    fn check_identifier<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(name) = e.as_ident() else {
            return;
        };
        let global_object = match name.bytes() {
            b"eval" => {
                if !ast_utils::is_callee(e) && refers_to_global_variable(e) {
                    cx.report(e, UNEXPECTED);
                }
                return;
            }
            b"global" => "global",
            b"window" => "window",
            b"globalThis" => "globalThis",
            _ => return,
        };
        let Node::Expr(mut member) = e.parent() else {
            return;
        };
        // `window.window.eval`
        while is_member(member, global_object) {
            let Node::Expr(parent) = member.parent() else {
                return;
            };
            member = parent;
        }
        if is_member(member, "eval") && refers_to_global_variable(e) {
            Self::report_member(member, cx);
        }
    }

    /// `this.eval` where `this` is the global object.
    fn check_this<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Node::Expr(member) = e.parent() else {
            return;
        };
        if !is_member(member, "eval") {
            return;
        }
        let mut child = Node::Expr(e);
        for ancestor in child.ancestors() {
            match ancestor {
                Node::Func(func) if !func.is_arrow() => {
                    if !func.scope().is_none_or(Scope::is_strict)
                        && ast_utils::is_default_this_binding(func, true)
                    {
                        Self::report_member(member, cx);
                    }
                    return;
                }
                // In the initializer of a field it is the instance or the class.
                Node::Member(field)
                    if field.kind() == MemberKind::Property
                        && !field.flags().contains(Flags::ACCESSOR)
                        && field.init().map(Node::Expr) == Some(child) =>
                {
                    return;
                }
                _ => {}
            }
            child = ancestor;
        }

        let (file, language) = (cx.file(), cx.language());
        let is_module = language.scope_source_type() == SourceType::Module;
        let is_top_level_of_script = !is_module && !language.global_return;
        if is_top_level_of_script
            || !(is_module || file.scope().is_strict() || file.top_level_scope().is_strict())
        {
            Self::report_member(member, cx);
        }
    }
}

impl Rule for NoEval {
    const META: Meta = Meta::eslint("no-eval", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoEval {
            allows_indirect: options.object(0).bool_or("allowIndirect", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.has_expr_named("eval") {
            return;
        }
        on.exprs([ExprTag::Call], Self::check_call);
        if !self.allows_indirect {
            on.exprs([ExprTag::Ident], Self::check_identifier);
            on.exprs([ExprTag::This], Self::check_this);
        }
    }
}

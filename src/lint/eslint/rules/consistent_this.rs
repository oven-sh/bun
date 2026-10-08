use bun_lint::prelude::*;

/// Enforce consistent naming when capturing the current execution context.
pub struct ConsistentThis {
    aliases: Vec<Box<[u8]>>,
}

const ALIAS_NOT_ASSIGNED_TO_THIS: Message = Message::new(
    "aliasNotAssignedToThis",
    "Designated alias '{{name}}' is not assigned to 'this'.",
);
const UNEXPECTED_ALIAS: Message =
    Message::new("unexpectedAlias", "Unexpected alias '{{name}}' for 'this'.");

/// The range of ESLint's `def.node`.
fn span_of_definition(declaration: Declaration) -> Option<Span> {
    match declaration {
        Declaration::ImportDefault(import) => Some(import.default()?.span()),
        Declaration::ImportNamespace(import) => import.namespace_span(),
        _ => declaration.node().map(utils::estree_span),
    }
}

/// `alias = this`, also where the alias is a part of a destructuring pattern.
fn is_assignment_of_this(reference: Reference) -> bool {
    let Some(write) = reference.write_expr() else {
        return false;
    };
    write.tag() == ExprTag::This
        && matches!(write.parent(), Node::Expr(parent)
            if matches!(parent.kind(), ExprKind::Assign { op: None, .. }) && !utils::is_assignment_target(parent))
}

impl ConsistentThis {
    fn is_alias(&self, name: Name) -> bool {
        let name = name.bytes();
        self.aliases.iter().any(|alias| **alias == *name)
    }

    /// The message for `name = value`, if it is to be reported.
    fn check_assignment(&self, name: Name, value: Expr, is_compound: bool) -> Option<Message> {
        let is_this = value.tag() == ExprTag::This;
        match self.is_alias(name) {
            true => (!is_this || is_compound).then_some(ALIAS_NOT_ASSIGNED_TO_THIS),
            false => is_this.then_some(UNEXPECTED_ALIAS),
        }
    }

    /// ESLint's `checkWasAssigned`.
    fn check_was_assigned<'a>(&self, symbol: Symbol<'a>, cx: &mut Cx<'a, Self>) {
        if !self.is_alias(symbol.name()) {
            return;
        }
        let scope = symbol.scope();
        let is_checked = match scope.kind() {
            ScopeKind::Global => true,
            ScopeKind::Module => cx.is_module_program(),
            ScopeKind::Function => {
                matches!(scope.node(), Node::Func(func) if !func.is_arrow() && func.has_body())
            }
            _ => false,
        };
        if !is_checked {
            return;
        }
        let has_initializer = symbol.declarations().any(|declaration| {
            matches!(declaration.node(), Some(Node::VarDecl(it)) if it.init().is_some())
        });
        if has_initializer
            || symbol.references().any(|it| it.scope() == scope && is_assignment_of_this(it))
        {
            return;
        }
        for span in symbol.declarations().filter_map(span_of_definition) {
            cx.report(span, ALIAS_NOT_ASSIGNED_TO_THIS).data("name", symbol.name());
        }
    }
}

impl Rule for ConsistentThis {
    const META: Meta = Meta::eslint("consistent-this", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let aliases: Vec<Box<[u8]>> = options.all().iter().filter_map(Json::as_str).map(Box::from).collect();
        ConsistentThis {
            aliases: match aliases.is_empty() {
                true => vec![Box::from(&b"that"[..])],
                false => aliases,
            },
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.var_decls(|rule, declaration, cx| {
            if let Some(init) = declaration.init()
                && let Some(name) = declaration.pat().as_ident()
                && let Some(message) = rule.check_assignment(name, init, false)
            {
                cx.report(declaration, message).data("name", name);
            }
        });
        on.exprs([ExprTag::Assign], |rule, e, cx| {
            if let ExprKind::Assign { op, target, value } = e.kind()
                && let Some(name) = target.as_ident()
                && let Some(message) = rule.check_assignment(name, value, op.is_some())
                && !(op.is_none() && utils::is_assignment_target(e))
            {
                cx.report(e, message).data("name", name);
            }
        });
        on.symbols(Self::check_was_assigned);
    }
}

use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Disallow variable or `function` declarations in nested blocks.
pub struct NoInnerDeclarations {
    is_both: bool,
    allows_block_scoped_functions: bool,
    has_options: bool,
    /// An option of oxlint.
    allows_namespaces: bool,
}

const MOVE_DECL_TO_ROOT: Message =
    Message::new("moveDeclToRoot", "Move {{type}} declaration to {{body}} root.");

/// It is directly in the file, in the body of a function or in a static block, or it is exported.
fn is_at_root(statement: Stmt) -> bool {
    matches!(statement.parent(), Node::File(_) | Node::Func(_)) || statement.is_exported()
}

/// ESLint's `getAllowedBodyDescription`.
fn get_allowed_body_description<'a>(statement: Stmt<'a>, cx: &mut Cx<'a, NoInnerDeclarations>) -> &'static str {
    let enclosing_function = cx.state.find(Node::Stmt(statement), |_, parent| parent.as_func().map(Func::kind));
    match enclosing_function {
        Some(FnKind::StaticBlock) => "class static block body",
        Some(_) => "function body",
        None => "program",
    }
}

impl NoInnerDeclarations {
    /// The rule of oxlint 1.87. Without options it allows no function in a block. What is in a namespace is not at the
    /// root, exported or not. It points at the keyword.
    fn check_as_oxlint<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let (kind, keyword) = match statement.kind() {
            StmtKind::Fn(func) if func.has_body() => {
                let is_strict = || {
                    let around = func.scope().and_then(Scope::parent);
                    around.is_some_and(|it| utils::oxlint::is_strict_mode(it, cx.file()))
                };
                if !self.is_both && self.has_options && self.allows_block_scoped_functions && is_strict() {
                    return;
                }
                ("function", "function")
            }
            StmtKind::Var(declarations)
                if self.is_both && declarations.first().is_some_and(|it| it.var_kind() == VarKind::Var) =>
            {
                ("variable", "var")
            }
            _ => return,
        };
        let is_in_namespace = matches!(statement.parent(), Node::Stmt(parent) if parent.tag() == StmtTag::Module);
        let is_allowed = if is_in_namespace { self.allows_namespaces } else { is_at_root(statement) };
        if !is_allowed {
            let body = get_allowed_body_description(statement, cx);
            let start = statement.span_without_export().start;
            cx.report(Span::new(start, start + keyword.len() as u32), MOVE_DECL_TO_ROOT)
                .data("type", kind)
                .data("body", body);
        }
    }
}

impl Rule for NoInnerDeclarations {
    const META: Meta = Meta::eslint("no-inner-declarations", Kind::Problem);
    /// The kind of the innermost function around a node.
    type State<'a> = AncestorMemo<'a, FnKind>;

    fn new(options: &Options) -> Self {
        NoInnerDeclarations {
            is_both: options.str(0) == Some("both"),
            allows_block_scoped_functions: options.object(1).str("blockScopedFunctions") != Some("disallow"),
            has_options: !options.is_empty(),
            allows_namespaces: options.object(1).str("namespaces") == Some("allow"),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Self::State<'a> {
        if file.language().is_oxlint {
            on.stmts([StmtTag::Fn], Self::check_as_oxlint);
            if self.is_both {
                on.stmts([StmtTag::Var], Self::check_as_oxlint);
            }
            return AncestorMemo::default();
        }
        on.stmts([StmtTag::Fn], |rule, statement, cx| {
            let StmtKind::Fn(func) = statement.kind() else {
                return;
            };
            if !func.has_body() || is_at_root(statement) {
                return;
            }
            if rule.allows_block_scoped_functions
                && cx.language().ecma_version >= 2015
                && func.scope().and_then(Scope::parent).is_some_and(Scope::is_strict)
            {
                return;
            }
            let body = get_allowed_body_description(statement, cx);
            cx.report(statement, MOVE_DECL_TO_ROOT).data("type", "function").data("body", body);
        });
        if self.is_both {
            on.stmts([StmtTag::Var], |_, statement, cx| {
                let StmtKind::Var(declarations) = statement.kind() else {
                    return;
                };
                if declarations.first().is_some_and(|it| it.var_kind() == VarKind::Var) && !is_at_root(statement) {
                    let body = get_allowed_body_description(statement, cx);
                    cx.report(statement, MOVE_DECL_TO_ROOT).data("type", "variable").data("body", body);
                }
            });
        }
        AncestorMemo::default()
    }
}

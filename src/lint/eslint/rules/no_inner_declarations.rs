use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Disallow variable or `function` declarations in nested blocks.
pub struct NoInnerDeclarations(Config);

pub const MOVE_DECL_TO_ROOT: Message =
    Message::new("moveDeclToRoot", "Move {{type}} declaration to {{body}} root.");

/// The options, and the check. eslint-plugin-svelte's rule of the same name is this one, except that a top-level
/// statement in a component's script counts as at the root.
pub struct Config {
    is_both: bool,
    allows_block_scoped_functions: bool,
    has_options: bool,
    /// An oxlint option.
    allows_namespaces: bool,
    /// True if a top-level statement in a script has the `Program` as its parent, not the `SvelteScriptElement`.
    scripts_are_roots: bool,
}

/// What [`Config::finding`] finds: `{{type}}`, and the reported position.
pub struct Finding {
    pub kind: &'static str,
    /// The keyword, for oxlint. Otherwise the statement.
    pub keyword: Option<Span>,
}

/// The kind of the innermost function around a node.
pub type State<'a> = AncestorMemo<'a, FnKind>;

impl Config {
    pub fn new(options: &Options) -> Config {
        Config {
            is_both: options.str(0) == Some("both"),
            allows_block_scoped_functions: options.object(1).str("blockScopedFunctions") != Some("disallow"),
            has_options: !options.is_empty(),
            allows_namespaces: options.object(1).str("namespaces") == Some("allow"),
            scripts_are_roots: false,
        }
    }

    /// For eslint-plugin-svelte's rule.
    pub fn new_for_svelte(options: &Options) -> Config {
        Config {
            scripts_are_roots: true,
            ..Config::new(options)
        }
    }

    /// The part of [`NoInnerDeclarations::ON`] the options listen to.
    pub fn narrow(&self) -> On {
        let mut on = On::new().stmts(&[StmtTag::Fn]);
        if self.is_both {
            on = on.stmts(&[StmtTag::Var]);
        }
        on
    }

    /// The finding for `statement`, a function or a `var`, if it isn't at the root.
    pub fn finding<'a>(&self, statement: Stmt<'a>, file: &'a File<'a>) -> Option<Finding> {
        let language = file.language();
        if language.is_oxlint {
            return self.finding_as_oxlint(statement, file);
        }
        let kind = match statement.kind() {
            StmtKind::Fn(func) => {
                if !func.has_body() || self.is_at_root(statement) {
                    return None;
                }
                if self.allows_block_scoped_functions
                    && language.ecma_version >= 2015
                    && func.scope().and_then(Scope::parent).is_some_and(Scope::is_strict)
                {
                    return None;
                }
                "function"
            }
            StmtKind::Var(declarations)
                if declarations.first().is_some_and(|it| it.var_kind() == VarKind::Var)
                    && !self.is_at_root(statement) =>
            {
                "variable"
            }
            _ => return None,
        };
        Some(Finding { kind, keyword: None })
    }

    /// True if it's directly in the file, a function body or a static block, or it's exported.
    fn is_at_root(&self, statement: Stmt) -> bool {
        let parent = statement.parent();
        let is_program = matches!(parent, Node::File(_)) && (self.scripts_are_roots || ast_utils::is_program(parent));
        is_program || matches!(parent, Node::Func(_)) || statement.is_exported()
    }

    /// oxlint 1.87's rule. Without options it allows no function in a block. Anything in a namespace isn't at the root,
    /// exported or not. It reports at the keyword.
    fn finding_as_oxlint<'a>(&self, statement: Stmt<'a>, file: &'a File<'a>) -> Option<Finding> {
        let (kind, keyword) = match statement.kind() {
            StmtKind::Fn(func) if func.has_body() => {
                let is_strict = || {
                    let outer_scope = func.scope().and_then(Scope::parent);
                    outer_scope.is_some_and(|it| utils::oxlint::is_strict_mode(it, file))
                };
                if !self.is_both && self.has_options && self.allows_block_scoped_functions && is_strict() {
                    return None;
                }
                ("function", "function")
            }
            StmtKind::Var(declarations)
                if self.is_both && declarations.first().is_some_and(|it| it.var_kind() == VarKind::Var) =>
            {
                ("variable", "var")
            }
            _ => return None,
        };
        let is_in_namespace = matches!(statement.parent(), Node::Stmt(parent) if parent.tag() == StmtTag::Module);
        let is_allowed = if is_in_namespace { self.allows_namespaces } else { self.is_at_root(statement) };
        let start = statement.span_without_export().start;
        let keyword = Some(Span::new(start, start + keyword.len() as u32));
        (!is_allowed).then_some(Finding { kind, keyword })
    }
}

/// ESLint's `getAllowedBodyDescription`.
pub fn get_allowed_body_description<'a>(statement: Stmt<'a>, state: &mut State<'a>) -> &'static str {
    let enclosing_function = state.find(Node::Stmt(statement), |_, parent| parent.as_func().map(Func::kind));
    match enclosing_function {
        Some(FnKind::StaticBlock) => "class static block body",
        Some(_) => "function body",
        None => "program",
    }
}

impl Rule for NoInnerDeclarations {
    const META: Meta = Meta::eslint("no-inner-declarations", Kind::Problem);
    const ON: On = On::new().stmts(&[StmtTag::Fn, StmtTag::Var]);
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        NoInnerDeclarations(Config::new(options))
    }

    fn narrow<'a>(&self, _: &'a File<'a>) -> On {
        self.0.narrow()
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Self::State<'a>> {
        Some(AncestorMemo::default())
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let Some(finding) = self.0.finding(statement, cx.file()) else {
            return;
        };
        let body = get_allowed_body_description(statement, &mut cx.state);
        match finding.keyword {
            Some(keyword) => cx.report(keyword, MOVE_DECL_TO_ROOT),
            None => cx.report(statement, MOVE_DECL_TO_ROOT),
        }
        .data("type", finding.kind)
        .data("body", body);
    }
}

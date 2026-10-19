use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint::types::IdMap;

/// Require or disallow initialization in variable declarations.
pub struct InitDeclarations {
    config: Config,
}

const INITIALIZED: Message = Message::new(
    "initialized",
    "Variable '{{idName}}' should be initialized on declaration.",
);
const NOT_INITIALIZED: Message = Message::new(
    "notInitialized",
    "Variable '{{idName}}' should not be initialized on declaration.",
);

/// The options, shared with typescript-eslint's rule of the same name.
pub struct Config {
    pub is_never: bool,
    ignore_for_loop_init: bool,
}

/// A problem with a declarator, to report unless `declare` exempts it.
pub struct Finding<'a> {
    pub message: Message,
    pub name: Name<'a>,
    /// The `var`, `let`, `const` or `using` statement.
    pub declaration: Stmt<'a>,
}

impl Config {
    pub fn new(options: &Options) -> Config {
        Config {
            is_never: options.str(0) == Some("never"),
            ignore_for_loop_init: options.object(1).bool_or("ignoreForLoopInit", false),
        }
    }

    #[inline]
    pub fn check<'a>(&self, decl: VarDecl<'a>) -> Option<Finding<'a>> {
        let Node::Stmt(declaration) = decl.parent() else {
            return None;
        };
        // Fast path for the common case.
        let is_in_loop = matches!(declaration.parent(), Node::Stmt(block) if block.is_loop());
        if !is_in_loop && decl.init().is_some() != self.is_never {
            return None;
        }
        self.check_slow_path(decl, declaration)
    }

    /// `declaration` is `decl`'s parent.
    #[inline(never)]
    fn check_slow_path<'a>(&self, decl: VarDecl<'a>, declaration: Stmt<'a>) -> Option<Finding<'a>> {
        // `Some` if its parent is a `for`, `for`-`in` or `for`-`of`, and true if it's in that loop's head.
        let in_for_loop = match declaration.parent() {
            Node::Stmt(block) if block.is_loop() => match block.kind() {
                StmtKind::For { init, .. } => Some(init == Some(declaration)),
                StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } => Some(left == declaration),
                _ => None,
            },
            _ => None,
        };
        let is_initialized = in_for_loop.unwrap_or_else(|| decl.init().is_some());
        if is_initialized != self.is_never {
            return None;
        }
        let name = decl.pat().as_ident()?;
        // For oxlint only a `const` has to be initialized.
        let is_oxlint = decl.file().language().is_oxlint;
        let has_to_be_initialized = match decl.var_kind() {
            VarKind::Var | VarKind::Let => false,
            VarKind::Const => true,
            VarKind::Using | VarKind::AwaitUsing => !is_oxlint,
        };
        if self.is_never && has_to_be_initialized {
            return None;
        }
        // The parameter of a `catch` is a `VarDecl` too.
        if declaration.tag() != StmtTag::Var {
            return None;
        }
        let message = match self.is_never {
            false if !is_initialized => INITIALIZED,
            // With `ignoreForLoopInit` oxlint reports nothing at all.
            true if is_initialized && !(self.ignore_for_loop_init && (in_for_loop.is_some() || is_oxlint)) => {
                NOT_INITIALIZED
            }
            _ => return None,
        };
        Some(Finding {
            message,
            name,
            declaration,
        })
    }
}

/// ESLint's `node.declare`.
pub fn has_declare(statement: Stmt) -> bool {
    statement.flags().contains(Flags::AMBIENT)
}

/// Returns the innermost `declare namespace` around `statement`.
pub fn enclosing_declared_namespace(statement: Stmt<'_>) -> Option<Module<'_>> {
    Node::Stmt(statement).ancestors().find_map(|ancestor| match ancestor.as_stmt()?.kind() {
        StmtKind::Module(module) if has_declare(module.stmt()) => Some(module),
        _ => None,
    })
}

/// Returns the end of the first `declare namespace` nested anywhere in `namespace`.
fn end_of_first_declared_namespace_in(namespace: Module<'_>) -> Option<u32> {
    let (mut first, mut pending) = (None, vec![namespace]);
    while let Some(namespace) = pending.pop() {
        for statement in namespace.innermost().body() {
            if let Some(inner) = statement.as_module() {
                let end = statement.span().end;
                if has_declare(statement) && first.is_none_or(|first| end < first) {
                    first = Some(end);
                }
                pending.push(inner);
            }
        }
    }
    first
}

#[derive(Default)]
pub struct State<'a> {
    declared_namespaces: AncestorMemo<'a, Module<'a>>,
    /// Caches [`end_of_first_declared_namespace_in`] for a `declare namespace`, keyed by its statement.
    first_ends: IdMap<Stmt<'a>, Option<u32>>,
}

/// ESLint's `insideDeclaredNamespace`, which is a flag rather than a depth: the end of a `declare namespace` clears it
/// for the rest of the enclosing one.
fn is_inside_declared_namespace<'a>(statement: Stmt<'a>, state: &mut State<'a>) -> bool {
    let namespace = state.declared_namespaces.find(Node::Stmt(statement), |_, ancestor| match ancestor.as_stmt()?.kind() {
        StmtKind::Module(module) if has_declare(module.stmt()) => Some(module),
        _ => None,
    });
    namespace.is_some_and(|namespace| {
        let first_end = *state
            .first_ends
            .get_or_insert_with(namespace.stmt(), || end_of_first_declared_namespace_in(namespace));
        first_end.is_none_or(|end| end > statement.span().start)
    })
}

impl Rule for InitDeclarations {
    const META: Meta = Meta::eslint("init-declarations", Kind::Suggestion).reports_on_exit();
    const ON: On = On::new().var_decls();
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        InitDeclarations {
            config: Config::new(options),
        }
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<State<'a>> {
        Some(State::default())
    }

    #[inline]
    fn var_decl<'a>(&self, decl: VarDecl<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(found) = self.config.check(decl) {
            Self::report(decl, &found, cx);
        }
    }
}

impl InitDeclarations {
    #[inline(never)]
    fn report<'a>(decl: VarDecl<'a>, found: &Finding<'a>, cx: &mut Cx<'a, Self>) {
        if decl.flags().contains(Flags::AMBIENT)
            && (has_declare(found.declaration) || is_inside_declared_namespace(found.declaration, &mut cx.state))
        {
            return;
        }
        cx.report(decl, found.message).data("idName", found.name);
    }
}

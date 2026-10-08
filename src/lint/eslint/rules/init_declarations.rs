use bun_lint::prelude::*;

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

/// The options, which typescript-eslint's rule of the same name shares.
pub struct Config {
    pub is_never: bool,
    ignore_for_loop_init: bool,
}

/// What there is to say about a declarator, if `declare` does not excuse it.
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

    pub fn check<'a>(&self, decl: VarDecl<'a>) -> Option<Finding<'a>> {
        let name = decl.pat().as_ident()?;
        if self.is_never && !matches!(decl.var_kind(), VarKind::Var | VarKind::Let) {
            return None;
        }
        let Node::Stmt(declaration) = decl.parent() else {
            return None;
        };
        // The parameter of a `catch` is a `VarDecl` too.
        if declaration.tag() != StmtTag::Var {
            return None;
        }
        // Whether it is in the head of the `for` statement that is its parent.
        let in_for_loop = match declaration.parent() {
            Node::Stmt(block) => match block.kind() {
                StmtKind::For { init, .. } => Some(init == Some(declaration)),
                StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } => Some(left == declaration),
                _ => None,
            },
            _ => None,
        };
        let is_initialized = in_for_loop.unwrap_or_else(|| decl.init().is_some());
        let message = match self.is_never {
            false if !is_initialized => INITIALIZED,
            true if is_initialized && !(self.ignore_for_loop_init && in_for_loop.is_some()) => NOT_INITIALIZED,
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

/// The innermost `declare namespace` around `statement`.
pub fn declared_namespace_around(statement: Stmt<'_>) -> Option<Module<'_>> {
    Node::Stmt(statement).ancestors().find_map(|ancestor| match ancestor.as_stmt()?.kind() {
        StmtKind::Module(module) if has_declare(module.stmt()) => Some(module),
        _ => None,
    })
}

/// Whether a `declare namespace` somewhere in `body` ends before `offset`.
fn has_declared_namespace_before<'a>(body: List<'a, Stmt<'a>>, offset: u32) -> bool {
    body.iter().take_while(|it| it.span().start < offset).any(|it| match it.kind() {
        StmtKind::Module(module) => {
            has_declare(it) && it.span().end <= offset
                || has_declared_namespace_before(module.innermost().body(), offset)
        }
        _ => false,
    })
}

/// ESLint's `insideDeclaredNamespace`, which is a flag and not a depth: the end of a
/// `declare namespace` clears it for the rest of the one around.
fn is_inside_declared_namespace(statement: Stmt) -> bool {
    declared_namespace_around(statement).is_some_and(|namespace| {
        !has_declared_namespace_before(namespace.innermost().body(), statement.span().start)
    })
}

impl Rule for InitDeclarations {
    const META: Meta = Meta::eslint("init-declarations", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        InitDeclarations {
            config: Config::new(options),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.var_decls(|rule, decl, cx| {
            let Some(found) = rule.config.check(decl) else {
                return;
            };
            if decl.flags().contains(Flags::AMBIENT)
                && (has_declare(found.declaration) || is_inside_declared_namespace(found.declaration))
            {
                return;
            }
            cx.report(decl, found.message).data("idName", found.name);
        });
    }
}

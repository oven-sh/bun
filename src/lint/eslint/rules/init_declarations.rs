use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use rustc_hash::FxHashMap;

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
            // With `ignoreForLoopInit` oxlint says nothing at all.
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

/// The innermost `declare namespace` around `statement`.
pub fn declared_namespace_around(statement: Stmt<'_>) -> Option<Module<'_>> {
    Node::Stmt(statement).ancestors().find_map(|ancestor| match ancestor.as_stmt()?.kind() {
        StmtKind::Module(module) if has_declare(module.stmt()) => Some(module),
        _ => None,
    })
}

/// Where the first of the `declare namespace`s somewhere in `namespace` ends.
fn end_of_first_declared_namespace_in(namespace: Module<'_>) -> Option<u32> {
    let (mut first, mut pending) = (None, vec![namespace]);
    while let Some(namespace) = pending.pop() {
        for statement in namespace.innermost().body() {
            if let StmtKind::Module(inner) = statement.kind() {
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
    /// [`end_of_first_declared_namespace_in`] a `declare namespace`, by its statement.
    first_ends: FxHashMap<Stmt<'a>, Option<u32>>,
}

/// ESLint's `insideDeclaredNamespace`, which is a flag and not a depth: the end of a
/// `declare namespace` clears it for the rest of the one around.
fn is_inside_declared_namespace<'a>(statement: Stmt<'a>, state: &mut State<'a>) -> bool {
    let namespace = state.declared_namespaces.find(Node::Stmt(statement), |_, ancestor| match ancestor.as_stmt()?.kind() {
        StmtKind::Module(module) if has_declare(module.stmt()) => Some(module),
        _ => None,
    });
    namespace.is_some_and(|namespace| {
        let first_end = state.first_ends.entry(namespace.stmt());
        let first_end = *first_end.or_insert_with(|| end_of_first_declared_namespace_in(namespace));
        first_end.is_none_or(|end| end > statement.span().start)
    })
}

impl Rule for InitDeclarations {
    const META: Meta = Meta::eslint("init-declarations", Kind::Suggestion);
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

    fn var_decl<'a>(&self, decl: VarDecl<'a>, cx: &mut Cx<'a, Self>) {
        let Some(found) = self.config.check(decl) else {
            return;
        };
        if decl.flags().contains(Flags::AMBIENT)
            && (has_declare(found.declaration) || is_inside_declared_namespace(found.declaration, &mut cx.state))
        {
            return;
        }
        cx.report(decl, found.message).data("idName", found.name);
    }
}

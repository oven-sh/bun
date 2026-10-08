use bun_lint::prelude::*;

/// Disallow `require` calls to be mixed with regular variable declarations.
pub struct NoMixedRequires {
    grouping: bool,
    allow_call: bool,
}

const NO_MIX_REQUIRE: Message =
    Message::new("noMixRequire", "Do not mix 'require' and other declarations.");
const NO_MIX_CORE_MODULE_FILE_COMPUTED: Message = Message::new(
    "noMixCoreModuleFileComputed",
    "Do not mix core, module, file and computed requires.",
);

const BUILTIN_MODULES: [&str; 29] = [
    "assert",
    "buffer",
    "child_process",
    "cluster",
    "crypto",
    "dgram",
    "dns",
    "domain",
    "events",
    "fs",
    "http",
    "https",
    "net",
    "os",
    "path",
    "punycode",
    "querystring",
    "readline",
    "repl",
    "smalloc",
    "stream",
    "string_decoder",
    "tls",
    "tty",
    "url",
    "util",
    "v8",
    "vm",
    "zlib",
];

const DECL_REQUIRE: u8 = 1 << 0;
const DECL_UNINITIALIZED: u8 = 1 << 1;
const DECL_OTHER: u8 = 1 << 2;

const REQ_CORE: u8 = 1 << 0;
const REQ_FILE: u8 = 1 << 1;
const REQ_MODULE: u8 = 1 << 2;
const REQ_COMPUTED: u8 = 1 << 3;

/// ESLint's `inferModuleType`, of an initializer that is a `DECL_REQUIRE`.
fn infer_module_type(mut init: Expr) -> u8 {
    while let ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } = init.kind() {
        init = obj;
    }
    let Some(ExprKind::String(value)) = init.as_call().and_then(|call| call.args().first()).map(Expr::kind)
    else {
        return REQ_COMPUTED;
    };
    if value.is_any(&BUILTIN_MODULES) {
        return REQ_CORE;
    }
    let path = value.bytes();
    if path.starts_with(b"/") || path.starts_with(b"./") || path.starts_with(b"../") {
        return REQ_FILE;
    }
    REQ_MODULE
}

impl NoMixedRequires {
    /// ESLint's `getDeclarationType`.
    fn declaration_type(&self, init: Option<Expr>) -> u8 {
        let Some(mut init) = init else {
            return DECL_UNINITIALIZED;
        };
        loop {
            // ESLint has a `ChainExpression` here.
            if init.is_chain_root() {
                return DECL_OTHER;
            }
            init = match init.kind() {
                ExprKind::Call(call) => match call.callee().kind() {
                    ExprKind::Ident(name) if name.is("require") => return DECL_REQUIRE,
                    ExprKind::Call(_) if self.allow_call => call.callee(),
                    _ => return DECL_OTHER,
                },
                ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => obj,
                _ => return DECL_OTHER,
            };
        }
    }

    fn check<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::Var(declarations) = stmt.kind() else {
            return;
        };
        let mut contains = 0;
        for declaration in declarations {
            contains |= self.declaration_type(declaration.init());
        }
        if contains & DECL_REQUIRE == 0 {
            return;
        }
        if contains != DECL_REQUIRE {
            cx.report(stmt.span_without_export(), NO_MIX_REQUIRE);
            return;
        }
        if !self.grouping {
            return;
        }
        let mut found: u8 = 0;
        for init in declarations.iter().filter_map(VarDecl::init) {
            found |= infer_module_type(init);
        }
        if found.count_ones() > 1 {
            cx.report(stmt.span_without_export(), NO_MIX_CORE_MODULE_FILE_COMPUTED);
        }
    }
}

impl Rule for NoMixedRequires {
    const META: Meta = Meta::eslint("no-mixed-requires", Kind::Suggestion).deprecated();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        NoMixedRequires {
            grouping: options.bool(0).unwrap_or_else(|| object.bool_or("grouping", false)),
            allow_call: object.bool_or("allowCall", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts([StmtTag::Var], Self::check);
    }
}

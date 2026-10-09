use bun_lint_oxlint::ast_util::{as_call_expression, is_specific_id};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow `require` calls to be mixed with regular variable declarations.
pub struct NoMixedRequires {
    grouping: bool,
    allow_call: bool,
}

const NO_MIX_REQUIRE: Message = Message::new("", "Do not mix 'require' and other declarations.");
const NO_MIX_CORE_MODULE_FILE_COMPUTED: Message = Message::new("", "Do not mix core, module, file and computed requires.");

/// `require("module").builtinModules` of Node.js 13.8. Sorted.
const BUILTIN_MODULES: [&str; 54] = [
    "_http_agent", "_http_client", "_http_common", "_http_incoming", "_http_outgoing", "_http_server", "_stream_duplex",
    "_stream_passthrough", "_stream_readable", "_stream_transform", "_stream_wrap", "_stream_writable", "_tls_common",
    "_tls_wrap", "assert", "async_hooks", "buffer", "child_process", "cluster", "console", "constants", "crypto", "dgram",
    "dns", "domain", "events", "fs", "http", "http2", "https", "inspector", "module", "net", "os", "path", "perf_hooks",
    "process", "punycode", "querystring", "readline", "repl", "stream", "string_decoder", "sys", "timers", "tls",
    "trace_events", "tty", "url", "util", "v8", "vm", "worker_threads", "zlib",
];

impl Rule for NoMixedRequires {
    const META: Meta = Meta::oxlint(Plugin::Node, "no-mixed-requires", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        NoMixedRequires {
            grouping: options.bool(0).or_else(|| object.bool("grouping")).unwrap_or(false),
            allow_call: object.bool_or("allowCall", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("require") {
            return;
        }
        on.stmts([StmtTag::Var], |rule, stmt, cx| {
            let StmtKind::Var(declarations) = stmt.kind() else {
                return;
            };
            if declarations.len() < 2 {
                return;
            }
            // Whether there is a `require`, and anything else. Then which kinds of modules are required.
            let (mut has_require, mut has_other, mut found) = (false, false, [false; 4]);
            for init in declarations.iter().map(VarDecl::init) {
                match init.filter(|it| rule.is_require_declaration(*it)) {
                    Some(init) => {
                        has_require = true;
                        found[infer_module_type(init) as usize] = true;
                    }
                    None => has_other = true,
                }
            }
            if has_require && has_other {
                cx.report(stmt.span_without_export(), NO_MIX_REQUIRE);
            } else if rule.grouping && found.iter().filter(|it| **it).count() > 1 {
                cx.report(stmt.span_without_export(), NO_MIX_CORE_MODULE_FILE_COMPUTED);
            }
        });
    }
}

#[derive(Copy, Clone)]
enum ModuleType {
    Core,
    File,
    Module,
    Computed,
}

/// `Expression::as_member_expression`: the object of a `Dot` or an `Index` that is neither in parentheses nor an optional chain.
fn object_of_member_expression(e: Expr<'_>) -> Option<Expr<'_>> {
    e.object().filter(|_| !e.is_parenthesized() && !e.is_chain_root())
}

impl NoMixedRequires {
    /// `get_declaration_type(init) == DeclarationType::Require`: `require("a")`, `require("a").b.c`, and with `allowCall`
    /// `require("a")(b)(c).d`.
    fn is_require_declaration(&self, init: Expr) -> bool {
        let mut at = init;
        loop {
            if let Some(object) = object_of_member_expression(at) {
                at = object;
                continue;
            }
            let Some(call) = as_call_expression(at) else {
                return false;
            };
            if is_specific_id(call.callee(), "require") {
                return true;
            }
            if !self.allow_call || as_call_expression(call.callee()).is_none() {
                return false;
            }
            at = call.callee();
        }
    }
}

fn infer_module_type(init: Expr) -> ModuleType {
    let mut at = init;
    while let Some(object) = object_of_member_expression(at) {
        at = object;
    }
    let Some(call) = as_call_expression(at) else {
        return ModuleType::Module;
    };
    let Some(value) = call.args().first().filter(|it| !it.is_parenthesized()).and_then(Expr::as_string).map(Name::bytes) else {
        return ModuleType::Computed;
    };
    if BUILTIN_MODULES.binary_search_by(|it| it.as_bytes().cmp(value)).is_ok() {
        ModuleType::Core
    } else if value.starts_with(b"./") || value.starts_with(b"../") || value.starts_with(b"/") {
        ModuleType::File
    } else {
        ModuleType::Module
    }
}

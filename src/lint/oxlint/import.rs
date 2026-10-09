//! What oxlint's rules of `import` ask about the file itself: the parts of its `ModuleRecord` that take no table, and a few methods of
//! `LintContext` and `oxc_ast`. Each has the name that it has there. The whole record is in [`crate::module_record`].
//!
//! The record is about the top level of the file: what is in a `declare module "m" { .. }` or a namespace is not in it.

use crate::ast_util::{is_specific_id, scope_made_by};
use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;
pub use bun_lint::utils::oxlint::{has_module_syntax, is_script};
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::{SmallVec, smallvec};

/// `node.scope_id() == ctx.scoping().root_scope_id()`: nothing around `node` makes a scope in `oxc_semantic`. `memo`: for this
/// question only.
pub fn is_in_root_scope<'a>(node: Node<'a>, memo: &mut AncestorMemo<'a, ()>) -> bool {
    memo.find(node, |child, parent| {
        scope_made_by(child, parent).map(|_| ())
    })
    .is_none()
}

/// For [`is_assignment_target`].
pub type AssignmentTargets<'a> = AncestorMemo<'a, bool>;

/// [`Expr::is_assignment_target`], for a rule that asks it of many expressions: that goes up through all the array and object literals
/// around each.
pub fn is_assignment_target<'a>(e: Expr<'a>, memo: &mut AssignmentTargets<'a>) -> bool {
    let decide = |child: Node<'a>, parent: Node<'a>| {
        let at = match child {
            Node::Expr(at) if at.is_parenthesized() => return Some(false),
            Node::Expr(at) => at,
            // From a property to its object.
            _ => {
                return if matches!(parent, Node::Expr(_)) {
                    None
                } else {
                    Some(false)
                };
            }
        };
        match parent {
            Node::Expr(parent) => match parent.kind() {
                ExprKind::Assign { target, .. } => Some(target == at),
                ExprKind::Array(_) | ExprKind::Spread(_) => None,
                _ => Some(false),
            },
            Node::Prop(prop) if prop.value() == Some(at) && !prop.is_jsx_attribute() => None,
            Node::Stmt(parent) => Some(match parent.kind() {
                StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } => {
                    matches!(left.kind(), StmtKind::Expr(head) if head == at)
                }
                _ => false,
            }),
            _ => Some(false),
        }
    };
    memo.find(Node::Expr(e), decide).unwrap_or(false)
}

/// `CallExpression::is_require_call`: `require("a")`, `` require(`a${b}`) ``
pub fn is_require_call(call: Call) -> bool {
    let (callee, args) = (call.callee(), call.args());
    args.len() == 1
        && callee.is_ident("require")
        && !callee.is_parenthesized()
        && args.first().is_some_and(|it| {
            matches!(it.tag(), ExprTag::String | ExprTag::Template) && !it.is_parenthesized()
        })
}

/// `CallExpression::common_js_require`: the `"a"` of `require("a")`.
pub fn common_js_require(call: Call<'_>) -> Option<Expr<'_>> {
    let args = call.args();
    let first = args
        .first()
        .filter(|it| args.len() == 1 && it.tag() == ExprTag::String && !it.is_parenthesized())?;
    is_specific_id(call.callee(), "require").then_some(first)
}

/// The statements at the top level and in the namespaces, which is where an `import` or an `export` can be, in the order of the source.
pub fn module_items<'a>(file: &'a File<'a>) -> impl Iterator<Item = Stmt<'a>> {
    let mut pending: SmallVec<[ListIter<'a, Stmt<'a>>; 4]> = smallvec![file.body().iter()];
    std::iter::from_fn(move || {
        loop {
            let Some(stmt) = pending.last_mut()?.next() else {
                pending.pop();
                continue;
            };
            if let StmtKind::Module(module) = stmt.kind() {
                pending.push(module.innermost().body().iter());
            }
            return Some(stmt);
        }
    })
}

/// `AstKind::ExportDeclaration`: `export` before a declaration, not `export default`.
pub fn is_export_declaration(stmt: Stmt) -> bool {
    matches!(
        stmt.tag(),
        StmtTag::Var
            | StmtTag::Fn
            | StmtTag::Class
            | StmtTag::Interface
            | StmtTag::TypeAlias
            | StmtTag::Enum
            | StmtTag::Module
            | StmtTag::ImportEquals
    ) && stmt.flags() & (Flags::EXPORT | Flags::DEFAULT) == Flags::EXPORT
}

/// `ExportDeclaration::export_kind().is_type()`
pub fn is_type_export_declaration(stmt: Stmt) -> bool {
    matches!(stmt.tag(), StmtTag::Interface | StmtTag::TypeAlias)
        || stmt.tag() != StmtTag::ImportEquals && stmt.flags().contains(Flags::AMBIENT)
}

/// What an [`ImportEntry`] imports, with where it is written.
#[derive(Copy, Clone)]
pub enum ImportImportName<'a> {
    /// `import { a as b }`
    Name(ImportSpec<'a>),
    /// `import * as b`: the `b`.
    NamespaceObject(Ident<'a>),
    /// `import b`: the `b`.
    Default(Ident<'a>),
}

/// A name that an `import` at the top level declares.
#[derive(Copy, Clone)]
pub struct ImportEntry<'a> {
    pub declaration: Import<'a>,
    pub import_name: ImportImportName<'a>,
}

impl<'a> ImportEntry<'a> {
    pub fn local_name(&self) -> Ident<'a> {
        match self.import_name {
            ImportImportName::Name(specifier) => specifier.local(),
            ImportImportName::NamespaceObject(local) | ImportImportName::Default(local) => local,
        }
    }

    pub fn is_type(&self) -> bool {
        self.declaration.is_type_only()
            || matches!(self.import_name, ImportImportName::Name(specifier) if specifier.is_type_only())
    }
}

/// The entries of one `import`.
pub fn import_entries_of(declaration: Import<'_>) -> impl Iterator<Item = ImportEntry<'_>> {
    let whole = (declaration
        .default()
        .map(ImportImportName::Default)
        .into_iter())
    .chain(
        declaration
            .namespace()
            .map(ImportImportName::NamespaceObject),
    );
    whole
        .chain(declaration.named().iter().map(ImportImportName::Name))
        .map(move |import_name| ImportEntry {
            declaration,
            import_name,
        })
}

/// The `import`s at the top level.
pub fn import_declarations<'a>(file: &'a File<'a>) -> impl Iterator<Item = Import<'a>> {
    file.body().iter().filter_map(|stmt| match stmt.kind() {
        StmtKind::Import(declaration) => Some(declaration),
        _ => None,
    })
}

/// `ModuleRecord::import_entries`
pub fn import_entries<'a>(file: &'a File<'a>) -> impl Iterator<Item = ImportEntry<'a>> {
    import_declarations(file).flat_map(import_entries_of)
}

/// The names for which `export { name }` exports what another module has: `name` is imported, and not as a namespace. Such an entry
/// is among the `indirect_export_entries`.
fn reexported_imports<'a>(file: &'a File<'a>) -> FxHashSet<Name<'a>> {
    // The first import of a name counts.
    let mut is_reexported: FxHashMap<Name<'a>, bool> = FxHashMap::default();
    for entry in import_entries(file) {
        let is_namespace = matches!(entry.import_name, ImportImportName::NamespaceObject(_));
        is_reexported
            .entry(entry.local_name().name())
            .or_insert(!is_namespace);
    }
    is_reexported
        .into_iter()
        .filter(|it| it.1)
        .map(|it| it.0)
        .collect()
}

/// The span of oxc's `ExportNamedDeclaration` or `ExportDefaultDeclaration`, which starts at the `export`: `@a export class B {}`.
pub fn export_declaration_span(stmt: Stmt) -> Span {
    stmt.export_span().unwrap_or_else(|| stmt.span())
}

/// The `default` of `export default ..`.
pub fn default_keyword_span(stmt: Stmt) -> Span {
    let keyword = stmt
        .modifiers()
        .iter()
        .find(|it| it.flag() == Flags::DEFAULT)
        .map(|it| it.span());
    keyword.unwrap_or_else(|| {
        let start = skip_trivia(
            stmt.file().text(),
            stmt.span().start + "export".len() as u32,
        );
        Span::new(start, start + "default".len() as u32)
    })
}

/// `ModuleRecord::export_default`: the `default` of the first `export default ..` or `export { a as default }`. If there is none, of
/// the first that exports what another module has.
pub fn export_default<'a>(file: &'a File<'a>) -> Option<Span> {
    let mut indirect = None;
    let mut reexported_imports_of_file = None;
    for stmt in file.body() {
        match stmt.kind() {
            StmtKind::ExportDefault(_) => return Some(default_keyword_span(stmt)),
            StmtKind::Fn(_) | StmtKind::Class(_) | StmtKind::Interface(_)
                if stmt.is_default_export() =>
            {
                return Some(default_keyword_span(stmt));
            }
            StmtKind::ExportNamed(export) => {
                for specifier in export
                    .items()
                    .iter()
                    .filter(|it| it.exported().name().is("default"))
                {
                    let mut is_reexported_import = |name: Name<'a>| {
                        reexported_imports_of_file
                            .get_or_insert_with(|| reexported_imports(file))
                            .contains(&name)
                    };
                    if !export.has_from() && !is_reexported_import(specifier.local().name()) {
                        return Some(specifier.exported().span());
                    }
                    indirect = indirect.or_else(|| Some(specifier.exported().span()));
                }
            }
            StmtKind::ExportStar {
                alias: Some(alias), ..
            } if alias.name().is("default") => {
                indirect = indirect.or_else(|| Some(alias.span()));
            }
            _ => {}
        }
    }
    indirect
}

/// The crate `nodejs-built-in-modules`: what Node.js 24 has. Sorted.
const BUILTINS: [&str; 68] = [
    "_http_agent",
    "_http_client",
    "_http_common",
    "_http_incoming",
    "_http_outgoing",
    "_http_server",
    "_stream_duplex",
    "_stream_passthrough",
    "_stream_readable",
    "_stream_transform",
    "_stream_wrap",
    "_stream_writable",
    "_tls_common",
    "_tls_wrap",
    "assert",
    "assert/strict",
    "async_hooks",
    "buffer",
    "child_process",
    "cluster",
    "console",
    "constants",
    "crypto",
    "dgram",
    "diagnostics_channel",
    "dns",
    "dns/promises",
    "domain",
    "events",
    "fs",
    "fs/promises",
    "http",
    "http2",
    "https",
    "inspector",
    "inspector/promises",
    "module",
    "net",
    "os",
    "path",
    "path/posix",
    "path/win32",
    "perf_hooks",
    "process",
    "punycode",
    "querystring",
    "readline",
    "readline/promises",
    "repl",
    "stream",
    "stream/consumers",
    "stream/promises",
    "stream/web",
    "string_decoder",
    "sys",
    "timers",
    "timers/promises",
    "tls",
    "trace_events",
    "tty",
    "url",
    "util",
    "util/types",
    "v8",
    "vm",
    "wasi",
    "worker_threads",
    "zlib",
];
const BUILTINS_WITH_MANDATORY_NODE_PREFIX: [&str; 4] = ["sea", "sqlite", "test", "test/reporters"];

pub fn is_nodejs_builtin_module(specifier: &[u8]) -> bool {
    let is_builtin = |name: &[u8]| {
        BUILTINS
            .binary_search_by(|it| it.as_bytes().cmp(name))
            .is_ok()
    };
    match specifier.strip_prefix(b"node:") {
        Some(stripped) => {
            is_builtin(stripped)
                || BUILTINS_WITH_MANDATORY_NODE_PREFIX
                    .iter()
                    .any(|it| it.as_bytes() == stripped)
        }
        None => is_builtin(specifier),
    }
}

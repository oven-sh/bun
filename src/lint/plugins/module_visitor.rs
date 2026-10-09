//! `moduleVisitor` of eslint-module-utils: every place where a file names a module.

use bun_lint::prelude::*;

/// Its options.
#[derive(Copy, Clone)]
pub(crate) struct Systems {
    pub(crate) esmodule: bool,
    pub(crate) commonjs: bool,
    pub(crate) amd: bool,
}

/// What it calls its visitor with.
pub(crate) struct Visited<'a> {
    /// `source.value`
    pub(crate) specifier: &'a [u8],
    pub(crate) source: Span,
    pub(crate) importer: Node<'a>,
    /// `moduleSystem`
    pub(crate) is_require: bool,
}

/// In the order of the source.
pub(crate) fn visit<'a>(file: &'a File<'a>, systems: Systems) -> Vec<Visited<'a>> {
    let mut visited = Vec::new();
    let string_of = |e: Expr<'a>| e.as_string().map(Name::bytes);
    if systems.esmodule {
        for tag in [StmtTag::Import, StmtTag::ExportNamed, StmtTag::ExportStar] {
            for stmt in file.stmts_of_kind(tag) {
                let specifier = match stmt.kind() {
                    StmtKind::Import(import) => Some(import.spec()),
                    StmtKind::ExportNamed(export) => export.spec(),
                    StmtKind::ExportStar { spec, .. } => spec,
                    _ => None,
                };
                if let (Some(specifier), Some(source)) = (specifier, stmt.module_specifier_span()) {
                    visited.push(Visited {
                        specifier: specifier.bytes(),
                        source,
                        importer: stmt.into(),
                        is_require: false,
                    });
                }
            }
        }
        for e in file.exprs_of_kind(ExprTag::ImportCall) {
            if let ExprKind::ImportCall { args } = e.kind()
                && let Some(source) = args.first()
                && let Some(specifier) = string_of(source)
            {
                visited.push(Visited {
                    specifier,
                    source: source.span(),
                    importer: e.into(),
                    is_require: false,
                });
            }
        }
    }
    if systems.commonjs || systems.amd {
        for e in file.exprs_of_kind(ExprTag::Call) {
            let ExprKind::Call(call) = e.kind() else {
                continue;
            };
            let (Some(callee), args) = (call.callee().as_ident(), call.args()) else {
                continue;
            };
            let mut require = |specifier: &'a [u8], source: Expr<'a>, importer: Expr<'a>| {
                visited.push(Visited {
                    specifier,
                    source: source.span(),
                    importer: importer.into(),
                    is_require: true,
                });
            };
            if systems.commonjs
                && callee.is("require")
                && args.len() == 1
                && let Some(module_path) = args.first()
            {
                let specifier = match module_path.kind() {
                    ExprKind::Template(template) => template.as_static().map(Name::bytes),
                    _ => string_of(module_path),
                };
                if let Some(specifier) = specifier {
                    require(specifier, module_path, e);
                }
            }
            if systems.amd
                && callee.is_any(&["require", "define"])
                && args.len() == 2
                && let Some(ExprKind::Array(elements)) = args.first().map(Expr::kind)
            {
                for element in elements {
                    if let Some(specifier) =
                        string_of(element).filter(|it| !matches!(*it, b"require" | b"exports"))
                    {
                        require(specifier, element, element);
                    }
                }
            }
        }
    }
    utils::sort::sort_by_key(&mut visited, |it| {
        (
            it.importer.span().start,
            std::cmp::Reverse(it.importer.span().end),
        )
    });
    visited
}

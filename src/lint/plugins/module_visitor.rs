#![allow(dead_code)] // until every rule of the plugin is written
//! `moduleVisitor` of eslint-module-utils: every place where a file names a module. And
//! `isStaticRequire` of eslint-plugin-import.

use bun_lint::prelude::*;
use std::cmp::Reverse;

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

/// `moduleSystem`, as [`Visited::is_require`] has it.
const IMPORT: bool = false;
const REQUIRE: bool = true;

/// What has a `source`.
const DECLARATIONS: [StmtTag; 3] = [StmtTag::Import, StmtTag::ExportNamed, StmtTag::ExportStar];

/// [`Visitor::visit`] without `ignore`.
pub(crate) fn visit<'a>(file: &'a File<'a>, systems: Systems) -> Vec<Visited<'a>> {
    Visitor::of(systems).visit(file)
}

/// `isStaticRequire`: the argument. Also of `require?.("a")` and `(require)(("a"))`.
pub(crate) fn static_require(call: Call<'_>) -> Option<Expr<'_>> {
    let arguments = call.args();
    if !call.callee().is_ident("require") || arguments.len() != 1 {
        return None;
    }
    arguments.first().filter(|it| it.as_string().is_some())
}

/// `visitModules` with its options.
pub(crate) struct Visitor {
    pub(crate) systems: Systems,
    /// `ignoreRegExps`
    ignore: Vec<Regex>,
}

impl Visitor {
    pub(crate) fn new(options: Object) -> Visitor {
        let ignore = options.array("ignore").iter();
        Visitor {
            systems: Systems {
                esmodule: options.bool_or("esmodule", true),
                commonjs: options.bool_or("commonjs", false),
                amd: options.bool_or("amd", false),
            },
            ignore: ignore
                .filter_map(|it| Regex::from_bytes(it.as_str()?, b"").ok())
                .collect(),
        }
    }

    pub(crate) fn of(systems: Systems) -> Visitor {
        Visitor {
            systems,
            ignore: Vec::new(),
        }
    }

    /// `false`: [`Visitor::visit`] finds nothing.
    pub(crate) fn may_visit(&self, file: &File) -> bool {
        let may_visit_declarations = self.systems.esmodule
            && (file.has_stmts(DECLARATIONS) || file.has_exprs([ExprTag::ImportCall]));
        may_visit_declarations || (self.may_visit_calls(file) && file.has_exprs([ExprTag::Call]))
    }

    /// Whether a callee can be the `require` or the `define` that the systems look for.
    fn may_visit_calls(&self, file: &File) -> bool {
        let Systems { commonjs, amd, .. } = self.systems;
        ((commonjs || amd) && file.mentions("require")) || (amd && file.mentions("define"))
    }

    /// In the order in which ESLint comes to the nodes that `visitModules` listens for.
    pub(crate) fn visit<'a>(&self, file: &'a File<'a>) -> Vec<Visited<'a>> {
        let Systems {
            esmodule,
            commonjs,
            amd,
        } = self.systems;
        let mut checks = Checks {
            ignore: &self.ignore,
            visited: Vec::new(),
        };
        if esmodule {
            for tag in DECLARATIONS {
                for node in file.stmts_of_kind(tag) {
                    checks.check_source(node);
                }
            }
            for node in file.exprs_of_kind(ExprTag::ImportCall) {
                checks.check_import_call(node);
            }
        }
        if self.may_visit_calls(file) {
            for node in file.exprs_of_kind(ExprTag::Call) {
                let Some(call) = node.as_call() else {
                    continue;
                };
                if commonjs {
                    checks.check_common(node, call);
                }
                if amd {
                    checks.check_amd(node, call);
                }
            }
        }
        let mut visited = checks.visited;
        utils::sort::sort_by_key(&mut visited, |it| (it.0.start, Reverse(it.0.end)));
        visited.into_iter().map(|it| it.1).collect()
    }
}

/// A `Literal` whose value is a string: the value, and where it is.
type Source<'a> = (&'a [u8], Span);

fn string_literal(e: Expr<'_>) -> Option<Source<'_>> {
    Some((e.as_string()?.bytes(), e.span()))
}

/// The functions inside `visitModules`.
struct Checks<'a, 'v> {
    ignore: &'v [Regex],
    /// The node that ESLint was at, and what the visitor was called with.
    visited: Vec<(Span, Visited<'a>)>,
}

impl<'a> Checks<'a, '_> {
    fn check_source_value(
        &mut self,
        at: Span,
        source: Option<Source<'a>>,
        importer: Node<'a>,
        is_require: bool,
    ) {
        let Some((specifier, source)) = source else {
            return;
        };
        if self.ignore.iter().any(|re| re.test(specifier)) {
            return;
        }
        let visited = Visited {
            specifier,
            source,
            importer,
            is_require,
        };
        self.visited.push((at, visited));
    }

    fn check_source(&mut self, node: Stmt<'a>) {
        let specifier = match node.kind() {
            StmtKind::Import(import) => Some(import.spec()),
            StmtKind::ExportNamed(export) => export.spec(),
            StmtKind::ExportStar { spec, .. } => spec,
            _ => None,
        };
        let source = specifier.and_then(|it| Some((it.bytes(), node.module_specifier_span()?)));
        self.check_source_value(node.span(), source, node.into(), IMPORT);
    }

    fn check_import_call(&mut self, node: Expr<'a>) {
        let ExprKind::ImportCall { args } = node.kind() else {
            return;
        };
        let Some(module_path) = args.first().and_then(string_literal) else {
            return;
        };
        self.check_source_value(node.span(), Some(module_path), node.into(), IMPORT);
    }

    fn check_common(&mut self, node: Expr<'a>, call: Call<'a>) {
        let Some(module_path) = static_require(call).and_then(string_literal) else {
            return;
        };
        self.check_source_value(node.span(), Some(module_path), node.into(), REQUIRE);
    }

    fn check_amd(&mut self, node: Expr<'a>, call: Call<'a>) {
        let (callee, arguments) = (call.callee().as_ident(), call.args());
        if !callee.is_some_and(|it| it.is_any(&["require", "define"])) || arguments.len() != 2 {
            return;
        }
        let Some(ExprKind::Array(elements)) = arguments.first().map(Expr::kind) else {
            return;
        };
        for element in elements {
            let Some(source) = string_literal(element) else {
                continue;
            };
            // The magic modules of RequireJS.
            if matches!(source.0, b"require" | b"exports") {
                continue;
            }
            self.check_source_value(node.span(), Some(source), element.into(), REQUIRE);
        }
    }
}

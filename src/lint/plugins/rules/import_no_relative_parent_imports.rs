use crate::import_type::{ImportType, ImportTypes};
use crate::module_visitor::{Systems, Visitor};
use bun_lint::paths;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint_oxlint::import::common_js_require;

/// Forbid importing modules from parent directories.
pub struct NoRelativeParentImports {
    visitor: Visitor,
}

const FROM_PARENT: Message = Message::new(
    "",
    "Relative imports from parent directories are not allowed. Please either pass what you're importing through at \
     runtime (dependency injection), move `{{filename}}` to same directory as `{{depPath}}` or consider making \
     `{{depPath}}` a package.",
);
const OXLINT: Message = Message::new("", "Relative imports from parent directories are not allowed");

/// The module systems oxlint checks, regardless of the options.
const OXLINT_SYSTEMS: Systems = Systems { esmodule: true, commonjs: true, amd: false };

/// oxlint's `is_parent_import`
fn is_parent_import(path: &[u8]) -> bool {
    let mut normalized = path;
    while let Some(rest) = normalized.strip_prefix(b"./") {
        normalized = rest;
    }
    paths::is_external(normalized)
}

/// True if it's an `import()` with a parenthesized specifier.
fn has_parentheses(importer: Node) -> bool {
    let Node::Expr(importer) = importer else {
        return false;
    };
    matches!(importer.kind(), ExprKind::ImportCall { args } if args.first().is_some_and(Expr::is_parenthesized))
}

impl Rule for NoRelativeParentImports {
    const META: Meta = Meta::plugin(Plugin::Import, "no-relative-parent-imports", Kind::Suggestion).needs_modules();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoRelativeParentImports { visitor: Visitor::new(options.object(0)) }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        // oxlint never touches the disk.
        if file.language().is_oxlint {
            return Visitor::of(OXLINT_SYSTEMS).may_visit(file).then_some(());
        }
        let is_on_the_disk = file.modules().is_some() && file.path() != b"<text>";
        (is_on_the_disk && self.visitor.may_visit(file)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let file = cx.file();
        if file.language().is_oxlint {
            // oxlint uses the specifier as written. It rejects a parenthesized one, and finds `require` inside
            // TypeScript wrappers.
            let visited = Visitor::of(Systems { commonjs: false, ..OXLINT_SYSTEMS }).visit(file);
            let declared = visited.iter().filter(|it| !has_parentheses(it.importer));
            let declared = declared.map(|it| (it.specifier, it.source));
            let calls = file.mentions("require").then(|| file.exprs_of_kind(ExprTag::Call)).into_iter().flatten();
            let required = calls.filter_map(|it| common_js_require(it.as_call()?));
            let required = required.filter_map(|it| Some((it.as_string()?.bytes(), it.span())));
            for (_, source) in declared.chain(required).filter(|it| is_parent_import(it.0)) {
                cx.report(source, OXLINT);
            }
            return;
        }
        let (Some(types), Some(modules)) = (ImportTypes::of(file), file.modules()) else {
            return;
        };
        let cwd = modules.cwd();
        let directory = paths::resolve(cwd, paths::dirname(&paths::portable(file.path(), file.path())));
        for it in self.visitor.visit(file) {
            let resolved = types.resolvers().resolve(file, it.specifier, it.is_require);
            let Some(abs_dep_path) = resolved.file() else {
                continue;
            };
            if types.of_resolved(it.specifier, &resolved) == ImportType::External {
                continue;
            }
            let rel_dep_path = paths::relative(&directory, &paths::resolve(cwd, abs_dep_path));
            // Only a path that starts with `..` can be in a parent, and classifying a name can require resolving it.
            if rel_dep_path.starts_with(b"..") && types.of_name(&rel_dep_path, it.is_require) == ImportType::Parent {
                let filename = paths::basename(file.path());
                cx.report(it.source, FROM_PARENT).data("filename", filename).data("depPath", it.specifier);
            }
        }
    }
}

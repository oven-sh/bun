use crate::import_package_path::{pkg_up, read_pkg_up};
use crate::import_type::{ImportType, ImportTypes};
use crate::module_visitor::Visitor;
use bun_core::printer::json_stringify_alloc;
use bun_core::strings;
use bun_lint::modules::Modules;
use bun_lint::paths;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use std::cell::OnceCell;

/// Forbid importing packages through relative paths.
pub struct NoRelativePackages {
    visitor: Visitor,
}

const RELATIVE_PACKAGE: Message = Message::new(
    "",
    "Relative import from another package is not allowed. Use `{{properImport}}` instead of `{{importPath}}`",
);

/// What `findNamedPackage` returns, if its `pkg` is truthy.
struct NamedPackage {
    /// `pkg.name`. `None`: it is no string.
    name: Option<Vec<u8>>,
    /// Where its `package.json` is.
    path: Vec<u8>,
}

/// upstream's `findNamedPackage`. `None` also where that never ends: the `package.json` in the root has no name.
fn find_named_package(modules: &dyn Modules, file_path: &[u8]) -> Option<NamedPackage> {
    let mut from = file_path.to_vec();
    loop {
        let (pkg, path) = read_pkg_up(modules, &from)?;
        if !pkg.is_truthy() {
            return None;
        }
        if let Some(name) = pkg.get(b"name").filter(|it| it.is_truthy()) {
            return Some(NamedPackage { name: name.as_str().map(<[u8]>::to_vec), path });
        }
        let directory = paths::dirname(&path);
        let above = paths::dirname(directory);
        if above.len() == directory.len() {
            return None;
        }
        from = above.to_vec();
    }
}

impl Rule for NoRelativePackages {
    const META: Meta = Meta::plugin(Plugin::Import, "no-relative-packages", Kind::Suggestion)
        .fixable(Fixable::Code)
        .needs_modules();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoRelativePackages { visitor: Visitor::new(options.object(0)) }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (file.modules().is_some() && self.visitor.may_visit(file)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let file = cx.file();
        let (Some(modules), Some(types)) = (file.modules(), ImportTypes::of(file)) else {
            return;
        };
        // The `package.json` that is closest to the file, and `contextPkg`.
        let context = OnceCell::new();
        for visited in self.visitor.visit(file) {
            let import_path = visited.specifier;
            let import_type = types.of_name(import_path, visited.is_require);
            if !matches!(import_type, ImportType::Parent | ImportType::Index | ImportType::Sibling) {
                continue;
            }
            let resolved = types.resolvers().resolve(file, import_path, visited.is_require);
            let Some(resolved_import) = resolved.file() else {
                continue;
            };
            let (closest, context_pkg) = context
                .get_or_init(|| (pkg_up(modules, file.path()), find_named_package(modules, file.path())));
            let Some(context_pkg) = context_pkg else {
                return;
            };
            // Both are in one package: nothing has to be read.
            if pkg_up(modules, resolved_import) == *closest {
                continue;
            }
            let Some(import_pkg) = find_named_package(modules, resolved_import) else {
                continue;
            };
            // At a name that is no string `path.join` throws.
            let Some(name) = import_pkg.name.filter(|it| context_pkg.name.as_ref() != Some(it)) else {
                continue;
            };
            let import_base_name = paths::basename(import_path);
            let import_root = paths::dirname(&import_pkg.path);
            let proper_path = paths::relative(import_root, resolved_import);
            let in_package = paths::join_normalized(&name, paths::dirname(&proper_path));
            let proper_import = match import_base_name == paths::basename(import_root) {
                true => in_package,
                false => paths::join_normalized(&in_package, import_base_name),
            };
            cx.report(visited.source, RELATIVE_PACKAGE)
                .data("properImport", paths::to_native(proper_import.clone()))
                .data("importPath", import_path)
                .fix(|fixer| {
                    // upstream's `toPosixPath`
                    let posix = strings::replace_owned(&proper_import, b"\\", b"/");
                    fixer.replace(visited.source, json_stringify_alloc(&posix))
                });
        }
    }
}

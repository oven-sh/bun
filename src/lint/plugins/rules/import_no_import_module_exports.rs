use crate::import_package_path::read_pkg_up;
use bun_glob::{Options as GlobOptions, Pattern};
use bun_lint::modules::{Lookup, Modules};
use bun_lint::paths;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use smallvec::SmallVec;

/// Forbid import statements with CommonJS module.exports.
pub struct NoImportModuleExports {
    exceptions: Vec<Pattern>,
}

const NO_IMPORT: Message = Message::new(
    "",
    "Cannot use import declarations in modules that export using CommonJS \
     (module.exports = 'foo' or exports.bar = 'hi')",
);

/// `Object.keys(Module._extensions)`
const EXTENSIONS: [&[u8]; 3] = [b".js", b".json", b".node"];

/// `getEntryPoint`: what `require.resolve` finds for the directory of the closest `package.json`.
fn get_entry_point(modules: &dyn Modules, file_name: &[u8]) -> Option<Vec<u8>> {
    let (pkg @ Json::Object(_), pkg_path) = read_pkg_up(modules, file_name)? else {
        return None;
    };
    let directory = paths::dirname(&pkg_path);
    // A file of that name comes before the directory, and is not in it.
    if EXTENSIONS.iter().any(|it| modules.exists(&[directory, *it].concat())) {
        return None;
    }
    let lookup = Lookup::Node(SmallVec::from_slice(&EXTENSIONS));
    let is_require = true;
    let find = |request: &[u8]| modules.resolve_file(&pkg_path, request, is_require, &lookup);
    let main = pkg.get(b"main").and_then(Json::as_str).filter(|it| !it.is_empty());
    main.and_then(|it| find(&paths::resolve(directory, it))).or_else(|| find(&paths::join(directory, b"index")))
}

/// `hasCJSExportReference && !isImportBinding`
fn has_cjs_export_reference<'a>(file: &'a File<'a>, identifier: Name<'a>) -> bool {
    // `findScope`: the last scope that declares the name, wherever it is.
    let Some(variable) = file.scopes().rev().find_map(|it| it.get_name(identifier)) else {
        return true;
    };
    // ESLint has the name of a class declaration in the scope of the class too, which comes later.
    variable.scope().kind() == ScopeKind::Module
        && !variable.declarations().any(|it| matches!(it, Declaration::Class(_)))
        && variable.declarations().next().and_then(Declaration::kind) != Some(DeclarationKind::ImportBinding)
}

impl NoImportModuleExports {
    /// Takes note of a `MemberExpression` that starts at `start`, if `object` is a keyword.
    fn see<'a>(object: Name<'a>, start: u32, cx: &mut Cx<'a, Self>) {
        for (keyword, first) in &mut cx.state {
            if *keyword == object {
                *first = start.min(*first);
            }
        }
    }

    /// `implements a.b`, and `extends a.b` of an interface: ESTree has a `MemberExpression` there.
    fn see_heritage<'a>(ty: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        if let TypeKind::Ref { name, .. } = ty.kind()
            && name.len() > 1
            && let Some(object) = name.first()
        {
            Self::see(object.name(), object.start(), cx);
        }
    }
}

impl Rule for NoImportModuleExports {
    const META: Meta =
        Meta::plugin(Plugin::Import, "no-import-module-exports", Kind::Problem).fixable(Fixable::Code).needs_modules();
    const ON: On = On::new().exprs(&[ExprTag::Dot, ExprTag::Index]).classes().stmts(&[StmtTag::Interface]).finish();
    /// `module` and `exports`, each with where the first `MemberExpression` of it starts.
    type State<'a> = [(Name<'a>, u32); 2];

    fn new(options: &Options) -> Self {
        let exceptions = options.object(0).strings("exceptions");
        let minimatch = |glob: &str| Pattern::new(&paths::from_native(glob.as_bytes()), GlobOptions::MINIMATCH_3);
        NoImportModuleExports { exceptions: exceptions.into_iter().map(minimatch).collect() }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let on = On::new().exprs(&[ExprTag::Dot, ExprTag::Index]).finish();
        if file.is_javascript() { on } else { on.classes().stmts(&[StmtTag::Interface]) }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        if !file.has_stmts([StmtTag::Import]) || !file.mentions_any(&["module", "exports"]) {
            return None;
        }
        Some([(file.name_of("module"), u32::MAX), (file.name_of("exports"), u32::MAX)])
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let (ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. }) = e.kind() else {
            return;
        };
        if let Some(object) = obj.as_ident()
            && cx.state.iter().any(|it| it.0 == object)
            && ast_utils::is_member_expression(e)
        {
            Self::see(object, e.span().start, cx);
        }
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if let StmtKind::Interface(interface) = statement.kind() {
            for ty in interface.extends() {
                Self::see_heritage(ty, cx);
            }
        }
    }

    fn class<'a>(&self, class: Class<'a>, cx: &mut Cx<'a, Self>) {
        for ty in class.implements() {
            Self::see_heritage(ty, cx);
        }
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let file = cx.file();
        let seen = cx.state.iter().filter(|it| it.1 != u32::MAX && has_cjs_export_reference(file, it.0));
        let (Some(first), Some(modules)) = (seen.map(|it| it.1).min(), file.modules()) else {
            return;
        };
        let file_name = paths::portable(file.path(), file.path());
        let is_exception = self.exceptions.iter().any(|it| it.matches(&file_name));
        if is_exception || get_entry_point(modules, &file_name).is_some_and(|it| it == file_name) {
            return;
        }
        // Those that ESLint has come to before the first such expression. After it nothing is reported.
        for import_declaration in file.stmts_of_kind(StmtTag::Import).filter(|it| it.span().start < first) {
            cx.report(import_declaration, NO_IMPORT);
        }
    }
}

use crate::bun::{CALLED, Each, calls_of_modules};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint_oxlint::ast_util::{callee_name, is_global_reference, static_string};

/// Prefer `new URL("./file", import.meta.url)` to a path that is joined onto the directory of the module.
///
/// Bundlers follow the former: see "new URL(url, import.meta.url)" in Vite's guide to static assets and "URL assets" in
/// webpack's guide to asset modules.
pub struct PreferUrlForSiblingFiles;

const JOINED_PATH: Message = Message::new(
    "joinedPath",
    "A bundler cannot tell which file this path names. It can with `new URL(\"./file\", import.meta.url)`.",
);

const PATH: Each<'static> =
    Each { names: &["node:path", "path"], then: &Each { names: &["join", "resolve"], then: &CALLED } };

/// `import.meta.name` for one of `names`.
fn is_meta_property(e: Expr, names: &[&str]) -> bool {
    matches!(e.kind(), ExprKind::Dot { obj, name, .. } if obj.tag() == ExprTag::ImportMeta && name.name().is_any(names))
}

/// The one argument of `name(argument)` or `object.name(argument)`.
fn argument_of<'a>(e: Expr<'a>, name: &str) -> Option<Expr<'a>> {
    let call = e.as_call().filter(|it| it.args().len() == 1 && callee_name(*it).is_some_and(|callee| callee.is(name)))?;
    call.args().first()
}

/// `__filename`, `import.meta.filename`, `import.meta.path`, `fileURLToPath(import.meta.url)`
fn is_own_file(e: Expr) -> bool {
    (e.is_ident("__filename") && is_global_reference(e))
        || is_meta_property(e, &["filename", "path"])
        || argument_of(e, "fileURLToPath").is_some_and(|it| is_meta_property(it, &["url"]))
}

/// `__dirname`, `import.meta.dirname`, `import.meta.dir`, `dirname()` of the file of the module
fn is_written_own_directory(e: Expr) -> bool {
    (e.is_ident("__dirname") && is_global_reference(e))
        || is_meta_property(e, &["dirname", "dir"])
        || argument_of(e, "dirname").is_some_and(is_own_file)
}

/// The same, or a constant that is declared as that.
fn is_own_directory(e: Expr) -> bool {
    let declared = || match e.symbol()?.declarations().next()?.node()? {
        Node::VarDecl(declaration) if declaration.var_kind() == VarKind::Const => declaration.init(),
        _ => None,
    };
    is_written_own_directory(e) || declared().is_some_and(is_written_own_directory)
}

/// Whether a path that ends with `end` can be that of a file: not `..`, `a/.`, `a/`.
fn can_name_a_file(end: &[u8]) -> bool {
    let name = end.get(strings::last_index_of_char(end, b'/').map_or(0, |it| it + 1)..);
    !matches!(name, None | Some(b"" | b"." | b".."))
}

/// `/a.txt`, to be put behind a directory.
fn is_rest_of_path(written: Option<Name>) -> bool {
    written.is_some_and(|it| it.bytes().starts_with(b"/") && can_name_a_file(it.bytes()))
}

impl Rule for PreferUrlForSiblingFiles {
    const META: Meta = Meta::plugin(Plugin::Bun, "prefer-url-for-sibling-files", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::Template]).binaries(&[BinOp::Add]).finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferUrlForSiblingFiles
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let on = On::new().exprs(&[ExprTag::Template]).binaries(&[BinOp::Add]);
        if PATH.names.iter().any(|it| file.mentions(it)) { on.finish() } else { on }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        // There is no `import.meta.url` in a script.
        if !file.is_module() || !["__dirname", "dirname", "dir"].iter().any(|it| file.mentions(it)) {
            return None;
        }
        Some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let ExprKind::Template(template) = e.kind()
            && template.exprs().len() == 1
            && template.cooked(0).is_some_and(|it| it.bytes().is_empty())
            && is_rest_of_path(template.cooked(1))
            && template.exprs().first().is_some_and(is_own_directory)
        {
            cx.report(e, JOINED_PATH);
        }
    }

    fn binary<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let ExprKind::Binary { left, right, .. } = e.kind()
            && is_rest_of_path(static_string(right))
            && is_own_directory(left)
        {
            cx.report(e, JOINED_PATH);
        }
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        for (e, _) in calls_of_modules(cx.file(), &PATH) {
            if let Some(arguments) = e.as_call().map(Call::args)
                && arguments.len() > 1
                && arguments.first().is_some_and(is_own_directory)
                && arguments.iter().skip(1).all(|it| static_string(it).is_some())
                && arguments.last().and_then(static_string).is_some_and(|it| can_name_a_file(it.bytes()))
            {
                cx.report(e, JOINED_PATH);
            }
        }
    }
}

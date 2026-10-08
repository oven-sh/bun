use bun_core::strings;
use bun_lint::prelude::*;

/// Disallow the use of `undefined` as an identifier.
pub struct NoUndefined;

const UNEXPECTED_UNDEFINED: Message =
    Message::new("unexpectedUndefined", "Unexpected use of undefined.");

impl NoUndefined {
    /// A variable that the file declares.
    fn check_symbol<'a>(&self, symbol: Symbol<'a>, cx: &mut Cx<'a, Self>) {
        if !symbol.name().is("undefined") {
            return;
        }
        for reference in symbol.references().filter(|it| !it.is_init()) {
            cx.report(reference, UNEXPECTED_UNDEFINED);
        }
        for declaration in symbol.declarations() {
            let span = match declaration {
                Declaration::Var(pat) | Declaration::Param(pat) => Some(utils::estree_span(pat.into())),
                _ => declaration.name_span(),
            };
            let Some(span) = span else {
                continue;
            };
            cx.report(span, UNEXPECTED_UNDEFINED);
            // ESLint has a second variable for the name, in the scope of the class.
            if let Declaration::Class(class) = declaration
                && matches!(class.owner(), Node::Stmt(_))
            {
                cx.report(span, UNEXPECTED_UNDEFINED);
            }
        }
    }

    /// The global variable.
    fn check_global<'a>(&self, cx: &mut Cx<'a, Self>) {
        if !ast_utils::is_configured_global(cx.file(), b"undefined") {
            return;
        }
        for reference in cx.file().unresolved_references() {
            if reference.name().is("undefined") && !reference.is_init() {
                cx.report(reference, UNEXPECTED_UNDEFINED);
            }
        }
    }
}

impl Rule for NoUndefined {
    const META: Meta = Meta::eslint("no-undefined", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoUndefined
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        // The name can be written with an escape.
        if strings::contains(file.text(), b"undefined") || strings::contains(file.text(), b"\\u") {
            on.symbols(Self::check_symbol);
            on.finish(Self::check_global);
        }
    }
}

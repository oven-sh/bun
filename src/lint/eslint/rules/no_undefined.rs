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
    const ON: On = On::new().symbols().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoUndefined
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        file.mentions("undefined").then_some(())
    }

    fn symbol<'a>(&self, symbol: Symbol<'a>, cx: &mut Cx<'a, Self>) {
        self.check_symbol(symbol, cx);
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        self.check_global(cx);
    }
}

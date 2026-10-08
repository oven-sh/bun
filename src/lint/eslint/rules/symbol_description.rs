use bun_lint::prelude::*;
use bun_lint::utils::ast_utils;

/// Require symbol descriptions.
pub struct SymbolDescription;

const EXPECTED: Message = Message::new("expected", "Expected Symbol to have a description.");

impl Rule for SymbolDescription {
    const META: Meta = Meta::eslint("symbol-description", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        SymbolDescription
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        // typescript-eslint always has the variable, from the default library.
        if file.is_javascript() && !ast_utils::is_configured_global(file, b"Symbol") {
            return;
        }
        on.exprs([ExprTag::Call], |_, e, cx| {
            if let ExprKind::Call(call) = e.kind()
                && call.args().is_empty()
                && call.callee().is_ident("Symbol")
                && call.callee().symbol().is_none()
            {
                cx.report(e, EXPECTED);
            }
        });
    }
}

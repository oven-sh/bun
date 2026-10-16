use bun_lint::prelude::*;
use bun_lint::utils::ast_utils;

/// Require symbol descriptions.
pub struct SymbolDescription;

const EXPECTED: Message = Message::new("expected", "Expected Symbol to have a description.");

impl Rule for SymbolDescription {
    const META: Meta = Meta::eslint("symbol-description", Kind::Suggestion).reports_at_the_end();
    const ON: On = On::new().function_calls(&["Symbol"]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        SymbolDescription
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        if file.mentions("Symbol") { Self::ON } else { On::new() }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        ast_utils::is_configured_global(file, b"Symbol").then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(call) = e.as_call()
            && call.args().is_empty()
            && call.callee().is_ident("Symbol")
            && call.callee().reference().is_some_and(|it| it.symbol().is_none())
            // A script can add declarations to the global variable, such as `interface Symbol {}`.
            && cx.file().scope().get("Symbol").is_none()
        {
            cx.report(e, EXPECTED);
        }
    }
}

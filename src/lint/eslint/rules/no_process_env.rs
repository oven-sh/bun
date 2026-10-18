use bun_lint::prelude::*;

/// Disallow the use of `process.env`.
pub struct NoProcessEnv;

const UNEXPECTED_PROCESS_ENV: Message =
    Message::new("unexpectedProcessEnv", "Unexpected use of process.env.");

impl Rule for NoProcessEnv {
    const META: Meta = Meta::eslint("no-process-env", Kind::Suggestion).deprecated();
    const ON: On = On::new().members_named(&["env"]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoProcessEnv
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        file.mentions("process").then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some((obj, name, _)) = e.as_dot() else {
            return;
        };
        // The `name` of ESLint's `PrivateIdentifier` is without the `#`.
        if name.name().is_any(&["env", "#env"])
            && obj.is_ident("process")
            && !e.is_jsx_tag_name()
            && !e.is_in_type_query()
        {
            cx.report(e, UNEXPECTED_PROCESS_ENV);
        }
    }
}

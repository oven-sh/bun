use crate::import_export_record::is_module;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint_oxlint::import::has_module_syntax;

/// Forbid potentially ambiguous parse goal (`script` vs. `module`).
pub struct Unambiguous;

const AMBIGUOUS: Message = Message::new("", "This module could be parsed as a valid script.");
const OXLINT: Message = Message::new("", "This module could be mistakenly parsed as script instead of module");

impl Rule for Unambiguous {
    const META: Meta = Meta::plugin(Plugin::Import, "unambiguous", Kind::Suggestion);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        Unambiguous
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        let is_unambiguous = match file.language().is_oxlint {
            // oxlint asks about a script too, and its parser, for which `import.meta` and `await` make a module as well.
            true => has_module_syntax(file),
            false => !file.is_module_program() || is_module(file),
        };
        (!is_unambiguous).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        if cx.language().is_oxlint {
            // oxlint points at the start of the file.
            cx.report(Span::default(), OXLINT);
        } else if cx.uses_typescript_parser() {
            cx.report(cx.program_span(), AMBIGUOUS);
        } else {
            // espree's `Program` is the whole text.
            cx.report(cx.file().span(), AMBIGUOUS);
        }
    }
}

use bun_lint_oxlint::import::has_module_syntax;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Warn if a `module` could be mistakenly parsed as a `script` instead of as a pure ES module.
pub struct Unambiguous;

const UNAMBIGUOUS: Message = Message::new("", "This module could be mistakenly parsed as script instead of module");

impl Rule for Unambiguous {
    const META: Meta = Meta::oxlint(Plugin::Import, "unambiguous", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        Unambiguous
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !has_module_syntax(file) {
            on.finish(|_, cx| drop(cx.report(Span::default(), UNAMBIGUOUS)));
        }
    }
}

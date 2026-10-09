use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Reports use of a default export as a locally named import.
pub struct NoNamedDefault;

const NO_NAMED_DEFAULT: Message = Message::new("", "Replace default import with named import.");

impl Rule for NoNamedDefault {
    const META: Meta = Meta::oxlint(Plugin::Import, "no-named-default", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoNamedDefault
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.import_specs(|_, specifier, cx| {
            if !specifier.is_type_only() && specifier.imported().name().is("default") {
                cx.report(specifier.imported(), NO_NAMED_DEFAULT);
            }
        });
    }
}

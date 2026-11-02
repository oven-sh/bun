use crate::prettier::Settings;
use bun_lint::formats::FormatterKind;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Report code that `bun fmt` would print differently. It has the options and messages of `prettier/prettier`, and
/// doesn't need `prettier` installed. `PRETTIER`: the `prettier/prettier` rule itself, which reports code that Prettier
/// would print differently.
pub struct Format<const PRETTIER: bool = false>(Settings);

impl<const PRETTIER: bool> Rule for Format<PRETTIER> {
    const META: Meta = match PRETTIER {
        true => Meta::plugin(Plugin::Prettier, "prettier", Kind::Layout)
            .fixable(Fixable::Code)
            .hands_back(),
        false => Meta::plugin(Plugin::Bun, "format", Kind::Layout).fixable(Fixable::Code),
    };
    const ON: On = On::new().finish();
    no_state!();

    fn new(options: &Options) -> Self {
        Format(Settings::new(options))
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        self.0.check(
            if PRETTIER {
                FormatterKind::InstalledPrettier
            } else {
                FormatterKind::BunFormat
            },
            cx,
        );
    }
}

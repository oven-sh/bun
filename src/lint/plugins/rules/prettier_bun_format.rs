use crate::prettier::Settings;
use bun_lint::formats::Like;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Report what `bun fmt` prints otherwise. The options and the messages are those of `prettier/prettier`, and no `prettier`
/// has to be installed. `PRETTIER`: that rule, which reports what Prettier prints otherwise.
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
                Like::InstalledPrettier
            } else {
                Like::BunFormat
            },
            cx,
        );
    }
}

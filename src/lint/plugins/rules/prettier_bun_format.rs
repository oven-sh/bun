use crate::prettier::Settings;
use bun_lint::formats::Like;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Report what `bun format` prints otherwise. The options and the messages are those of `prettier/prettier`, and no `prettier`
/// has to be installed.
pub struct Format(Settings);

impl Rule for Format {
    const META: Meta = Meta::plugin(Plugin::Bun, "format", Kind::Layout).fixable(Fixable::Code);
    const ON: On = On::new().finish();
    no_state!();

    fn new(options: &Options) -> Self {
        Format(Settings::new(options))
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        self.0.check(Like::BunFormat, cx);
    }
}

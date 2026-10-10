use crate::prettier::Settings;
use bun_lint::formats::Like;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Report what Prettier prints otherwise.
pub struct Prettier(Settings);

impl Rule for Prettier {
    const META: Meta = Meta::plugin(Plugin::Prettier, "prettier", Kind::Layout).fixable(Fixable::Code).hands_back();
    const ON: On = On::new().finish();
    no_state!();

    fn new(options: &Options) -> Self {
        Prettier(Settings::new(options))
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        self.0.check(Like::InstalledPrettier, cx);
    }
}

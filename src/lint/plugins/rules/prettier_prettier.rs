use crate::prettier::Settings;
use bun_lint::formats::Like;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Report what Prettier prints otherwise.
pub struct Prettier(Settings);

impl Rule for Prettier {
    const META: Meta = Meta::plugin(Plugin::Prettier, "prettier", Kind::Layout).fixable(Fixable::Code).hands_back();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        Prettier(Settings::new(options))
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.finish(|rule, cx| rule.0.check(Like::InstalledPrettier, cx));
    }
}

use crate::prettier::Settings;
use bun_lint::formats::Like;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Report what `bun format` prints otherwise. The options and the messages are those of `prettier/prettier`, and no `prettier`
/// has to be installed.
pub struct Format(Settings);

impl Rule for Format {
    const META: Meta = Meta::plugin(Plugin::Bun, "format", Kind::Layout).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        Format(Settings::new(options))
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.finish(|rule, cx| rule.0.check(Like::BunFormat, cx));
    }
}

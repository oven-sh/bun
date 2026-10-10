use super::import_first::First;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Replaced by `import/first`.
pub struct ImportsFirst(First);

impl Rule for ImportsFirst {
    const META: Meta =
        Meta::plugin(Plugin::Import, "imports-first", Kind::Suggestion).fixable(Fixable::Code).deprecated();
    const ON: On = First::ON;
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        ImportsFirst(First::new(options))
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        self.0.start(file)
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        self.0.check(cx.file(), &|at, message| cx.report(at, message));
    }
}

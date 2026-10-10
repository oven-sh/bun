use bun_lint::prelude::*;
use bun_lint_eslint::rules::no_dupe_class_members::{Seen, check};

/// Disallow duplicate class members.
pub struct NoDupeClassMembers;

impl Rule for NoDupeClassMembers {
    const META: Meta = Meta::typescript("no-dupe-class-members", Kind::Problem)
        .extends_base_rule("no-dupe-class-members");
    const ON: On = On::new().classes();
    type State<'a> = Seen<'a>;

    fn new(_: &Options) -> Self {
        NoDupeClassMembers
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Seen<'a>> {
        Some(Vec::new())
    }

    fn class<'a>(&self, class: Class<'a>, cx: &mut Cx<'a, Self>) {
        let mut seen = std::mem::take(&mut cx.state);
        // oxlint, where this is ESLint's rule, looks at the names in brackets as ESLint does.
        check(class, !cx.language().is_oxlint, &mut seen, cx);
        cx.state = seen;
    }
}

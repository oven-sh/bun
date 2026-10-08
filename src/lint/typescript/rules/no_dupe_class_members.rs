use bun_lint::prelude::*;
use bun_lint_eslint::rules::no_dupe_class_members::{Seen, check};

/// Disallow duplicate class members.
pub struct NoDupeClassMembers;

impl Rule for NoDupeClassMembers {
    const META: Meta = Meta::typescript("no-dupe-class-members", Kind::Problem)
        .extends_base_rule("no-dupe-class-members");
    type State<'a> = Seen<'a>;

    fn new(_: &Options) -> Self {
        NoDupeClassMembers
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> Seen<'a> {
        on.classes(|_, class, cx| {
            let mut seen = std::mem::take(&mut cx.state);
            check(class, true, &mut seen, cx);
            cx.state = seen;
        });
        Vec::new()
    }
}

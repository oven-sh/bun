use bun_lint::prelude::*;
use bun_lint::utils::ts_scope::analyze_class_member_usage;

/// Disallow unused private class members.
pub struct NoUnusedPrivateClassMembers;

const UNUSED_PRIVATE_CLASS_MEMBER: Message = Message::new(
    "unusedPrivateClassMember",
    "Private class member '{{classMemberName}}' is defined but never used.",
);

impl Rule for NoUnusedPrivateClassMembers {
    const META: Meta = Meta::typescript("no-unused-private-class-members", Kind::Problem)
        .extends_base_rule("no-unused-private-class-members");
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoUnusedPrivateClassMembers
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.has_classes() {
            return;
        }
        on.finish(|_, cx| {
            let usage =
                analyze_class_member_usage(cx.file(), |member| member.is_private() || member.is_hash_private());
            for member in usage.members().iter().filter(|member| !member.is_used()) {
                cx.report(member.name.name_span, UNUSED_PRIVATE_CLASS_MEMBER)
                    .data("classMemberName", member.name.code_name.clone());
            }
        });
    }
}

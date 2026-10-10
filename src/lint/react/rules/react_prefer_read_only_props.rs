use crate::util_components::Components;
use crate::util_prop_types::declared;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce that props are read-only.
pub struct PreferReadOnlyProps;

const READ_ONLY_PROP: Message = Message::new("readOnlyProp", "Prop '{{name}}' should be read-only.");

/// upstream's `isReadonly`: without a type annotation nothing is.
fn is_readonly(signature: Member<'_>) -> bool {
    signature.ty().is_some() && signature.flags().contains(Flags::READONLY)
}

impl Rule for PreferReadOnlyProps {
    const META: Meta = Meta::plugin(Plugin::React, "prefer-read-only-props", Kind::None)
        .fixable(Fixable::Code)
        .reports_at_the_end();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferReadOnlyProps
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        Components::may_have_any(file).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let file = cx.file();
        let prop_types = declared(&[]);
        // Only a type declares a signature.
        let mut has_type = false;
        prop_types.nodes(file, &mut |node, _| {
            has_type |= match node {
                Node::Class(_) | Node::Func(_) => true,
                Node::Member(field) => field.ty().is_some(),
                _ => false,
            };
        });
        if !has_type {
            return;
        }
        let mut components = Components::new(file).with(prop_types);
        components.finish();
        components.say_what_is_left_out(cx);
        for id in components.list() {
            let Some(declared_prop_types) = &components.component(id).declared_prop_types else { continue };
            for (prop_name, prop) in declared_prop_types.iter() {
                // A method, a getter and a setter are `TSMethodSignature`s.
                if let Some(Node::Member(signature)) = prop.node
                    && signature.kind() == MemberKind::Property
                    && !is_readonly(signature)
                {
                    cx.report(signature, READ_ONLY_PROP)
                        .data("name", prop_name.to_vec())
                        .fix(|fixer| fixer.insert_before(signature, "readonly "));
                }
            }
        }
    }
}

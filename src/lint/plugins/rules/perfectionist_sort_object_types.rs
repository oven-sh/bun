use crate::perfectionist::Messages;
use crate::perfectionist::object_types::{self, Listened, State};
use crate::perfectionist::options::RuleOptions;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce sorted object types.
pub struct SortObjectTypes {
    options: RuleOptions,
}

const ORDER_ERROR: &Message = &Message::new(
    "unexpectedObjectTypesOrder",
    "Expected \"{{right}}\" to come before \"{{left}}\".",
);
const GROUP_ORDER_ERROR: &Message = &Message::new(
    "unexpectedObjectTypesGroupOrder",
    "Expected \"{{right}}\" ({{rightGroup}}) to come before \"{{left}}\" ({{leftGroup}}).",
);
const EXTRA_SPACING_ERROR: &Message = &Message::new(
    "extraSpacingBetweenObjectTypeMembers",
    "Extra spacing between \"{{left}}\" and \"{{right}}\".",
);
const MISSED_SPACING_ERROR: &Message = &Message::new(
    "missedSpacingBetweenObjectTypeMembers",
    "Missed spacing between \"{{left}}\" and \"{{right}}\".",
);

/// `availableMessageIds`
const MESSAGES: Messages = Messages {
    unexpected_order: ORDER_ERROR,
    unexpected_group_order: GROUP_ORDER_ERROR,
    unexpected_dependency_order: None,
    missed_spacing: MISSED_SPACING_ERROR,
    extra_spacing: EXTRA_SPACING_ERROR,
};

impl Rule for SortObjectTypes {
    const META: Meta = Meta::plugin(Plugin::Perfectionist, "sort-object-types", Kind::Suggestion)
        .fixable(Fixable::Code)
        .reports_on_exit();
    const ON: On = On::new().types(&[TypeTag::Object]);
    type State<'a> = State;

    fn new(options: &Options) -> Self {
        SortObjectTypes {
            options: RuleOptions::new(options, object_types::RULE),
        }
    }

    fn validate(options: &Options) -> Result<(), Vec<u8>> {
        RuleOptions::validate(options)
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<State> {
        Some(State(self.options.file_state(file.settings())))
    }

    fn ty<'a>(&self, ty: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        if let TypeKind::Object(members) = ty.kind() {
            object_types::sort_object_type_elements(
                &self.options,
                &MESSAGES,
                Listened::TypeLiteral(ty, members),
                cx,
            );
        }
    }
}

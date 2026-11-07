use crate::perfectionist::Messages;
use crate::perfectionist::object_types::{self, Listened, State};
use crate::perfectionist::options::RuleOptions;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce sorted interface properties.
pub struct SortInterfaces {
    options: RuleOptions,
}

const ORDER_ERROR: &Message = &Message::new(
    "unexpectedInterfacePropertiesOrder",
    "Expected \"{{right}}\" to come before \"{{left}}\".",
);
const GROUP_ORDER_ERROR: &Message = &Message::new(
    "unexpectedInterfacePropertiesGroupOrder",
    "Expected \"{{right}}\" ({{rightGroup}}) to come before \"{{left}}\" ({{leftGroup}}).",
);
const EXTRA_SPACING_ERROR: &Message = &Message::new(
    "extraSpacingBetweenInterfaceMembers",
    "Extra spacing between \"{{left}}\" and \"{{right}}\".",
);
const MISSED_SPACING_ERROR: &Message = &Message::new(
    "missedSpacingBetweenInterfaceMembers",
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

impl Rule for SortInterfaces {
    const META: Meta = Meta::plugin(Plugin::Perfectionist, "sort-interfaces", Kind::Suggestion)
        .fixable(Fixable::Code)
        .reports_on_exit();
    const ON: On = On::new().stmts(&[StmtTag::Interface]);
    type State<'a> = State;

    fn new(options: &Options) -> Self {
        SortInterfaces {
            options: RuleOptions::new(options, object_types::RULE),
        }
    }

    fn validate(options: &Options) -> Result<(), Vec<u8>> {
        RuleOptions::validate(options)
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<State> {
        Some(State(self.options.file_state(file.settings())))
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if let StmtKind::Interface(interface) = stmt.kind() {
            object_types::sort_object_type_elements(
                &self.options,
                &MESSAGES,
                Listened::Interface(stmt, interface),
                cx,
            );
        }
    }
}

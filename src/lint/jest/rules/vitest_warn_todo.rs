use crate::jest::{self, JestFnKind, JestGeneralFnKind};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule warns about usage of `.todo` in `describe`, `it`, or `test` functions.
pub struct WarnTodo;

const WARN_TODO: Message = Message::new("", "The use of `.todo` is not recommended.");

impl Rule for WarnTodo {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "warn-todo", Kind::Problem);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        WarnTodo
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !jest::is_test(file) || !file.mentions("todo") {
            return None;
        }
        Some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        for possible_jest_node in jest::iter_possible_jest_call_node(cx.file()) {
            if let Some(parsed_vi_fn_call) = jest::parse_general_jest_fn_call(cx.file(), possible_jest_node)
                && matches!(
                    parsed_vi_fn_call.kind,
                    JestFnKind::General(JestGeneralFnKind::Describe | JestGeneralFnKind::Test)
                )
                && let Some(modifier) = parsed_vi_fn_call.members.iter().find(|member| member.is_name_equal("todo"))
            {
                cx.report(modifier.span, WARN_TODO);
            }
        }
    }
}

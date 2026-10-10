use crate::jest::{self, JestFnKind, JestGeneralFnKind, PossibleJestNode};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce consistency in whether `.each` or `.for` is used to create parameterized tests.
pub struct ConsistentEachFor {
    /// For `describe`, `it`, `test` and `suite`: the method that is not to be used.
    not_allowed_methods: [Option<&'static str>; 4],
}

const CONSISTENT_EACH_FOR: Message =
    Message::new("", "`{{fn_kind}}` can not be used with `.{{method_used}}` to create parameterized test.");

const FUNCTIONS: [&str; 4] = ["describe", "it", "test", "suite"];

impl Rule for ConsistentEachFor {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "consistent-each-for", Kind::Suggestion);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let config = options.object(0);
        ConsistentEachFor {
            not_allowed_methods: FUNCTIONS.map(|it| match config.str(it) {
                Some("for") => Some("each"),
                Some("each") => Some("for"),
                _ => None,
            }),
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (self.not_allowed_methods.iter().flatten().any(|it| file.mentions(it)) && jest::is_test(file)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        jest::iter_possible_jest_call_node(cx.file()).for_each(|node| self.run(node, cx));
    }
}

impl ConsistentEachFor {
    fn run<'a>(&self, possible_jest_node: PossibleJestNode<'a>, cx: &Cx<'a, Self>) {
        let Some(jest_fn_call) = jest::parse_general_jest_fn_call(cx.file(), possible_jest_node) else {
            return;
        };
        if matches!(jest_fn_call.kind, JestFnKind::General(JestGeneralFnKind::Describe | JestGeneralFnKind::Test))
            && let Some(fn_kind) = FUNCTIONS.iter().position(|it| it.as_bytes() == jest_fn_call.name)
            && let Some(Some(not_allowed_method)) = self.not_allowed_methods.get(fn_kind)
            && let Some(last_method) = jest_fn_call.members.last()
            && last_method.is_name_equal(not_allowed_method)
        {
            cx.report(last_method.span, CONSISTENT_EACH_FOR)
                .data("fn_kind", jest_fn_call.name)
                .data("method_used", *not_allowed_method)
                .data("method", if *not_allowed_method == "each" { "for" } else { "each" });
        }
    }
}

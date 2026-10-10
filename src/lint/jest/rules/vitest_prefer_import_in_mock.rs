use bun_lint_oxlint::ast_util::callee_name;
use crate::jest::{self, PossibleJestNode};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule enforces using a dynamic `import()` in `vi.mock()` or `vi.doMock()`, which improves type information and
/// IntelliSense for the mocked module.
pub struct PreferImportInMock {
    fixable: bool,
}

const PREFER_IMPORT_IN_MOCK: Message = Message::new("", "Mocked modules must be dynamic imported.");

impl Rule for PreferImportInMock {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "prefer-import-in-mock", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        // Options that are not valid are as none.
        let config = options.object(0);
        PreferImportInMock { fixable: config.entries().len() != 1 || config.bool_or("fixable", true) }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (jest::is_test(file) && file.mentions_any(&["mock", "doMock"])).then_some(())
    }

    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        jest::iter_possible_jest_call_node(cx.file()).for_each(|node| self.run(node, cx));
    }
}

impl PreferImportInMock {
    fn run<'a>(&self, possible_jest_node: PossibleJestNode<'a>, cx: &Cx<'a, Self>) {
        if let Some(call_expr) = possible_jest_node.node.as_call()
            && callee_name(call_expr).is_some_and(|it| it.is_any(&["mock", "doMock"]))
            && let (Some(import_value), Some(last)) = (call_expr.args().first(), call_expr.args().last())
            && let Some(value) = import_value.as_string().filter(|_| !import_value.is_parenthesized())
            && jest::parse_general_jest_fn_call(cx.file(), possible_jest_node).is_some()
        {
            let report =
                cx.report(import_value.span().to(last.outer_span()), PREFER_IMPORT_IN_MOCK).data("path", value);
            if self.fixable {
                report.fix(|fixer| fixer.replace(import_value, [b"import('".as_slice(), value.bytes(), b"')".as_slice()].concat()));
            }
        }
    }
}

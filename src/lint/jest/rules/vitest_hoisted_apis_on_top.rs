use bun_lint_oxlint::import::import_entries;
use crate::jest::{self, AstKind, JestFnKind, JestGeneralFnKind, PossibleJestNode};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Requires hoisted Vitest APIs (`vi.mock`, `vi.unmock`, and `vi.hoisted`) to appear at the top level of the file.
pub struct HoistedApisOnTop;

const HOISTED_APIS_ON_TOP: Message = Message::new("", "Hoisted API cannot be used in a runtime location in this file.");
const MOVE_TO_THE_TOP: Message = Message::new("", "Moving hoisted methods to the top of the file");
const REPLACE_WITH_DO_MOCK: Message = Message::new("", "Replace `mock` with `doMock`.");

impl Rule for HoistedApisOnTop {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "hoisted-apis-on-top", Kind::Problem).has_suggestions();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        HoistedApisOnTop
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (jest::is_test(file) && file.mentions_any(&["mock", "hoisted", "unmock"])).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        jest::iter_possible_jest_call_node(cx.file()).for_each(|node| run(node, cx));
    }
}

fn run<'a>(possible_jest_node: PossibleJestNode<'a>, cx: &Cx<'a, HoistedApisOnTop>) {
    let node = possible_jest_node.node;
    let Some(vitest_fn) = jest::parse_general_jest_fn_call(cx.file(), possible_jest_node) else {
        return;
    };
    if vitest_fn.kind != JestFnKind::General(JestGeneralFnKind::Vitest) {
        return;
    }
    let Some(member) = vitest_fn.members.first() else {
        return;
    };
    let Some(member_name) = member.name().filter(|it| matches!(*it, b"mock" | b"hoisted" | b"unmock")) else {
        return;
    };
    let parent = AstKind::Expr(node).parent();
    let is_expression_statement = parent.as_stmt().is_some_and(|it| it.tag() == StmtTag::Expr);

    // `vi.hoisted()` can also be awaited, and be what a variable is declared with.
    let mut statement = parent;
    if member_name == b"hoisted" {
        if statement.as_expr().is_some_and(|it| it.tag() == ExprTag::Await) {
            statement = statement.parent();
        }
        if matches!(statement, AstKind::Other(Node::VarDecl(_))) {
            statement = statement.parent();
        }
    }
    let is_statement = statement.as_stmt().is_some_and(|it| match it.tag() {
        StmtTag::Expr => true,
        StmtTag::Var => member_name == b"hoisted" && !it.is_exported(),
        _ => false,
    });
    if is_statement && statement.parent() == AstKind::Program {
        return;
    }

    let report = cx.report(node, HOISTED_APIS_ON_TOP).suggest(MOVE_TO_THE_TOP, |fixer| {
        let last_import = import_entries(fixer.file()).last().map(|it| it.declaration.stmt().span().end);
        let before = if last_import.is_some() { "\n" } else { "" };
        let new_code = [before.as_bytes(), node.text(), b";\n".as_slice()].concat();
        [
            if is_expression_statement { fixer.remove(node) } else { fixer.replace(node, "undefined") },
            fixer.insert_after(Span::empty(last_import.unwrap_or(0)), new_code),
        ]
    });
    if member_name == b"mock" {
        report.suggest(REPLACE_WITH_DO_MOCK, |fixer| fixer.replace(member.span, "doMock"));
    }
}

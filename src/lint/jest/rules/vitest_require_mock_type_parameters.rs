use crate::jest::{self, JestFnKind, JestGeneralFnKind, PossibleJestNode};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforces the use of type parameters on `vi.fn()`, and optionally on `vi.importActual()` and `vi.importMock()`.
pub struct RequireMockTypeParameters {
    check_import_functions: bool,
}

const REQUIRE_MOCK_TYPE_PARAMETERS: Message = Message::new("", "Missing type parameters on mock function call");

impl Rule for RequireMockTypeParameters {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "require-mock-type-parameters", Kind::Problem);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        RequireMockTypeParameters { check_import_functions: options.object(0).bool_or("checkImportFunctions", false) }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        // `.ts`, `.mts`, `.tsx`, ..
        let file_name = strings::last_index_of_any(file.path(), b"/\\").and_then(|at| file.path().get(at + 1..));
        let extension = strings::rsplit_once_char(file_name.unwrap_or_else(|| file.path()), b'.').filter(|it| !it.0.is_empty());
        let names: &[&str] = if self.check_import_functions { &["fn", "importMock", "importActual"] } else { &["fn"] };
        if extension.is_some_and(|it| it.1.ends_with(b"ts") || it.1.ends_with(b"tsx"))
            && jest::is_test(file)
            && file.mentions_any(names)
        {
            on.finish(|rule, cx| jest::iter_possible_jest_call_node(cx.file()).for_each(|node| rule.run(node, cx)));
        }
    }
}

impl RequireMockTypeParameters {
    fn run<'a>(&self, possible_jest_node: PossibleJestNode<'a>, cx: &Cx<'a, Self>) {
        let Some(vi_fn) = jest::parse_general_jest_fn_call(cx.file(), possible_jest_node) else {
            return;
        };
        if vi_fn.kind != JestFnKind::General(JestGeneralFnKind::Vitest) {
            return;
        }
        let is_require_mock_type = |name: &[u8]| match name {
            b"fn" => true,
            b"importMock" | b"importActual" => self.check_import_functions,
            _ => false,
        };
        // What is not called needs no type.
        if let Some(member) = vi_fn.members.iter().find(|member| member.name().is_some_and(is_require_mock_type))
            && let Some(member_expression) = member.parent
            && let Some(call_expr) = jest::parent_expression(member_expression).and_then(Expr::as_call)
            && call_expr.callee() == member_expression
            && call_expr.type_args().is_empty()
        {
            cx.report(member.span, REQUIRE_MOCK_TYPE_PARAMETERS);
        }
    }
}

use crate::jest::{self, Ctx, JestFnKind, JestGeneralFnKind, PossibleJestNode, Runner};
use bun_core::strings;
use bun_lint::prelude::*;

/// Enforces the use of type parameters on `vi.fn()`, and optionally on `vi.importActual()` and `vi.importMock()`.
pub struct RequireMockTypeParameters<const RUNNER: u8 = { jest::VITEST }> {
    check_import_functions: bool,
}

const REQUIRE_MOCK_TYPE_PARAMETERS: Message = Message::new("", "Missing type parameters on mock function call");

impl<const RUNNER: u8> Rule for RequireMockTypeParameters<RUNNER> {
    const META: Meta = jest::meta(RUNNER, "require-mock-type-parameters", Kind::Problem);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        RequireMockTypeParameters { check_import_functions: options.object(0).bool_or("checkImportFunctions", false) }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        // `.ts`, `.mts`, `.tsx`, ..
        let file_name = strings::last_index_of_any(file.path(), b"/\\").and_then(|at| file.path().get(at + 1..));
        let extension = strings::rsplit_once_char(file_name.unwrap_or_else(|| file.path()), b'.').filter(|it| !it.0.is_empty());
        let names: &[&str] = if self.check_import_functions { &["fn", "importMock", "importActual"] } else { &["fn"] };
        (extension.is_some_and(|it| it.1.ends_with(b"ts") || it.1.ends_with(b"tsx"))
            && jest::mentions_any(file, if RUNNER == jest::BUN { &const { jest::mention_bits(["vi", "jest"]) } } else { &const { jest::mention_bits(["vi", "vitest"]) } })
            && file.mentions_any(names)
            && jest::is_test(file, RUNNER))
        .then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &|node, ctx| run(node, self.check_import_functions, ctx));
    }
}

fn run<'a>(possible_jest_node: PossibleJestNode<'a>, check_import_functions: bool, ctx: &Ctx<'a, '_>) {
    let Some(vi_fn) = jest::parse_general_jest_fn_call(ctx.file, possible_jest_node) else {
        return;
    };
    // Bun has both.
    let is_mocker = match vi_fn.kind {
        JestFnKind::General(JestGeneralFnKind::Vitest) => true,
        JestFnKind::General(JestGeneralFnKind::Jest) => ctx.runner == Runner::Bun,
        _ => false,
    };
    if !is_mocker {
        return;
    }
    let is_require_mock_type = |name: &[u8]| match name {
        b"fn" => true,
        b"importMock" | b"importActual" => check_import_functions,
        _ => false,
    };
    // What is not called needs no type.
    if let Some(member) = vi_fn.members.iter().find(|member| member.name().is_some_and(is_require_mock_type))
        && let Some(member_expression) = member.parent
        && let Some(call_expr) = jest::parent_expression(member_expression).and_then(Expr::as_call)
        && call_expr.callee() == member_expression
        && call_expr.type_args().is_empty()
    {
        let report = ctx.report(member.span, REQUIRE_MOCK_TYPE_PARAMETERS).data("method_name", member.name().unwrap_or_default());
        if vi_fn.kind == JestFnKind::General(JestGeneralFnKind::Jest) {
            report.help("Add a type parameter to the mock function, e.g. `jest.fn<() => void>()`.");
        }
    }
}

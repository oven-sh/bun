use bun_lint_oxlint::import::import_entries;
use crate::jest::{self, Ctx, JestFnKind, JestGeneralFnKind, PossibleJestNode, Runner};
use bun_lint::prelude::*;
use rustc_hash::FxHashMap;
use std::cell::OnceCell;

/// When testing a specific function, this rule aims to enforce passing a named function to `describe()` instead of an equivalent
/// hardcoded string.
pub struct PreferDescribeFunctionTitle<const RUNNER: u8 = { jest::VITEST }>;

const PREFER_DESCRIBE_FUNCTION_TITLE: Message =
    Message::new("", "Title description can not have the same content as a imported function name.");

impl<const RUNNER: u8> Rule for PreferDescribeFunctionTitle<RUNNER> {
    const META: Meta = jest::meta(RUNNER, "prefer-describe-function-title", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferDescribeFunctionTitle
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (jest::mentions_describe(file) && jest::is_test(file, RUNNER) && file.has_stmts([StmtTag::Import])).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        let imported_names = OnceCell::new();
        jest::run_on_jest_nodes(&ctx, &|node, ctx| run(node, &imported_names, ctx));
    }
}

/// What is imported, and whether as more than a type.
fn imported_names<'a>(file: &'a File<'a>) -> FxHashMap<Name<'a>, bool> {
    let mut imported_names: FxHashMap<Name, bool> = FxHashMap::default();
    for entry in import_entries(file) {
        *imported_names.entry(entry.local_name().name()).or_default() |= !entry.is_type();
    }
    imported_names
}

fn run<'a>(
    possible_jest_node: PossibleJestNode<'a>,
    imported: &OnceCell<FxHashMap<Name<'a>, bool>>,
    ctx: &Ctx<'a, '_>,
) {
    let file = ctx.file;
    let Some(arguments) = possible_jest_node.node.as_call().map(Call::args).filter(|it| it.len() >= 2) else {
        return;
    };
    let Some(title_arg) = arguments.first().filter(|it| !it.is_parenthesized() && !it.is_chain_root()) else {
        return;
    };
    // The name of what is tested, and how it is written.
    let (name, variable) = match title_arg.kind() {
        ExprKind::Dot { obj, name, .. } if name.bytes() == b"name" && !obj.is_parenthesized() => match obj.as_ident() {
            Some(identifier) => (identifier, identifier.bytes()),
            None => return,
        },
        ExprKind::String(value) => (value, file.slice(title_arg.span().shrink(1, 1))),
        _ => return,
    };
    if !jest::parse_general_jest_fn_call(file, possible_jest_node)
        .is_some_and(|it| it.kind == JestFnKind::General(JestGeneralFnKind::Describe))
    {
        return;
    }
    let Some(&is_value) = imported.get_or_init(|| imported_names(file)).get(&name) else {
        return;
    };
    let typecheck = file.settings().get(b"vitest").and_then(|it| it.get(b"typecheck")).and_then(Json::as_bool);
    if title_arg.tag() == ExprTag::String && typecheck == Some(true) {
        return;
    }
    let report = ctx.report(title_arg, PREFER_DESCRIBE_FUNCTION_TITLE);
    if is_value {
        report.fix(|fixer| fixer.replace(title_arg, variable));
    }
}

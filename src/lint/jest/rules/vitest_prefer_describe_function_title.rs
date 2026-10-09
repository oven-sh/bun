use bun_lint_oxlint::import::import_entries;
use crate::jest::{self, JestFnKind, JestGeneralFnKind, PossibleJestNode};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::FxHashMap;

/// When testing a specific function, this rule aims to enforce passing a named function to `describe()` instead of an equivalent
/// hardcoded string.
pub struct PreferDescribeFunctionTitle;

const PREFER_DESCRIBE_FUNCTION_TITLE: Message =
    Message::new("", "Title description can not have the same content as a imported function name.");

impl Rule for PreferDescribeFunctionTitle {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "prefer-describe-function-title", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferDescribeFunctionTitle
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if jest::is_test(file) && file.has_stmts([StmtTag::Import]) {
            on.finish(|_, cx| {
                // What is imported, and whether as more than a type.
                let mut imported_names: FxHashMap<Name, bool> = FxHashMap::default();
                for entry in import_entries(cx.file()) {
                    *imported_names.entry(entry.local_name().name()).or_default() |= !entry.is_type();
                }
                jest::iter_possible_jest_call_node(cx.file()).for_each(|node| run(node, &imported_names, cx));
            });
        }
    }
}

fn run<'a>(
    possible_jest_node: PossibleJestNode<'a>,
    imported_names: &FxHashMap<Name<'a>, bool>,
    cx: &Cx<'a, PreferDescribeFunctionTitle>,
) {
    let file = cx.file();
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
    let Some(&is_value) = imported_names.get(&name) else {
        return;
    };
    if !jest::parse_general_jest_fn_call(file, possible_jest_node)
        .is_some_and(|it| it.kind == JestFnKind::General(JestGeneralFnKind::Describe))
    {
        return;
    }
    let typecheck = file.settings().get(b"vitest").and_then(|it| it.get(b"typecheck")).and_then(Json::as_bool);
    if title_arg.tag() == ExprTag::String && typecheck == Some(true) {
        return;
    }
    let report = cx.report(title_arg, PREFER_DESCRIBE_FUNCTION_TITLE);
    if is_value {
        report.fix(|fixer| fixer.replace(title_arg, variable));
    }
}

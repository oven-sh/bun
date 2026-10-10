use crate::jest::{self, PossibleJestNode};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule aims to enforce the use of `toBeCalledTimes(1)` or `toHaveBeenCalledTimes(1)` over `toBeCalledOnce()` or
/// `toHaveBeenCalledOnce()`.
pub struct PreferCalledTimes;

const PREFER_CALLED_TIMES: Message = Message::new(
    "",
    "Use `toBeCalledTimes(1)` or `toHaveBeenCalledTimes(1)` instead of `toBeCalledOnce()` or `toHaveBeenCalledOnce()`",
);

impl Rule for PreferCalledTimes {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "prefer-called-times", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferCalledTimes
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (jest::is_test(file) && file.mentions_any(&["toBeCalledOnce", "toHaveBeenCalledOnce"])).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        jest::iter_possible_jest_call_node(cx.file()).for_each(|node| run(node, cx));
    }
}

fn run<'a>(jest_node: PossibleJestNode<'a>, cx: &Cx<'a, PreferCalledTimes>) {
    let Some(parsed_expect_call) = jest::parse_expect_jest_fn_call(cx.file(), jest_node) else {
        return;
    };
    let method_text = match parsed_expect_call.matcher().and_then(|it| it.name()) {
        Some(b"toBeCalledOnce") => "toBeCalledTimes",
        Some(b"toHaveBeenCalledOnce") => "toHaveBeenCalledTimes",
        _ => return,
    };
    cx.report(jest_node.node, PREFER_CALLED_TIMES).fix(|fixer| {
        let file = fixer.file();
        let expect_argument = parsed_expect_call.expect_arguments.and_then(List::first);
        let mut code = b"expect(".to_vec();
        code.extend_from_slice(expect_argument.map_or(b"".as_slice(), |it| file.slice(it.outer_span())));
        code.push(b')');
        for modifier in parsed_expect_call.modifiers() {
            code.push(b'.');
            code.extend_from_slice(file.slice(modifier.span));
        }
        code.push(b'.');
        code.extend_from_slice(method_text.as_bytes());
        code.extend_from_slice(b"(1)");
        fixer.replace(jest_node.node, code)
    });
}

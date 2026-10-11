use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint::utils::{ast_utils, text};

/// Enforce a maximum number of statements allowed in function blocks.
pub struct MaxStatements {
    /// `None`: `{ "maximum": 0 }`, which upstream compares with `undefined`.
    max: Option<usize>,
    ignore_top_level_functions: bool,
}

const EXCEED: Message = Message::new(
    "exceed",
    "{{name}} has too many statements ({{count}}). Maximum allowed is {{max}}.",
);

#[derive(Default)]
pub struct State<'a> {
    /// By the number of a function or a static block: the sum of the lengths of the `BlockStatement`s in it, without its body and
    /// without those of the functions and the static blocks in it.
    in_blocks: Vec<u32>,
    /// The function or the static block that a block is in.
    around: AncestorMemo<'a, Func<'a>>,
    /// With `ignoreTopLevelFunctions`: how many functions are in no other function or static block.
    count: usize,
    /// Those with too many statements, and how many.
    exceeding: Vec<(Func<'a>, usize)>,
    /// What is in a function or a static block.
    enclosed: AncestorMemo<'a, ()>,
}

impl MaxStatements {
    #[cold]
    #[inline(never)]
    fn report<'a>(func: Func<'a>, count: usize, max: usize, cx: &Cx<'a, Self>) {
        // oxlint points at the function, and knows the name that the function itself has.
        let (name, place) = match (cx.language().is_oxlint, func.name()) {
            (true, Some(name)) => ([&b"function `"[..], name.bytes(), b"`"].concat(), func.estree_span()),
            (true, None) => (b"function".to_vec(), func.estree_span()),
            (false, _) => {
                let name = ast_utils::get_function_name_with_kind(func);
                // Before ESLint 10 it is the whole function.
                let place = match cx.language().eslint_major < 10 {
                    true => func.estree_span(),
                    false => ast_utils::get_function_head_loc(func),
                };
                (text::upper_case_first(&name).into_owned(), place)
            }
        };
        cx.report(place, EXCEED)
            .data("name", name)
            .data("count", count)
            .data("max", max);
    }
}

impl Rule for MaxStatements {
    const META: Meta = Meta::eslint("max-statements", Kind::Suggestion).reports_on_exit();
    const ON: On = On::new().stmts(&[StmtTag::Block]).funcs().finish();
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        MaxStatements {
            max: match object.has("maximum") || object.has("max") {
                true => object.usize("maximum").filter(|&max| max != 0).or_else(|| object.usize("max")),
                false => Some(options.number(0).map_or(10, |max| max as usize)),
            },
            ignore_top_level_functions: options.object(1).bool_or("ignoreTopLevelFunctions", false),
        }
    }

    fn narrow<'a>(&self, _: &'a File<'a>) -> On {
        let on = On::new().stmts(&[StmtTag::Block]).funcs();
        if self.ignore_top_level_functions { on.finish() } else { on }
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<State<'a>> {
        Some(State::default())
    }

    fn stmt<'a>(&self, block: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        // A `with` statement has the same tag.
        let len = block.as_block().map_or(0, List::len);
        if len > 0
            && let Some(func) = cx.state.around.find(Node::Stmt(block), |_, parent| parent.as_func())
        {
            let at = func.id().idx();
            if at >= cx.state.in_blocks.len() {
                cx.state.in_blocks.resize(at + 1, 0);
            }
            if let Some(sum) = cx.state.in_blocks.get_mut(at) {
                *sum += len as u32;
            }
        }
    }

    fn func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        if !ast_utils::is_function_with_body(func) {
            return;
        }
        let is_top_level = self.ignore_top_level_functions
            && cx.state.enclosed.find(Node::Func(func), |_, it| it.as_func().map(|_| ())).is_none();
        if is_top_level {
            cx.state.count += 1;
        }
        let Some(max) = self.max else {
            return;
        };
        let in_blocks = cx.state.in_blocks.get(func.id().idx()).map_or(0, |it| *it as usize);
        let count = func.body_statements().map_or(0, List::len) + in_blocks;
        if count <= max {
            return;
        }
        match is_top_level {
            true => cx.state.exceeding.push((func, count)),
            false => Self::report(func, count, max, cx),
        }
    }

    /// A single top level function is taken for the wrapper of a module.
    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let Some(max) = self.max else {
            return;
        };
        if cx.state.count == 1 {
            return;
        }
        for (func, count) in std::mem::take(&mut cx.state.exceeding) {
            Self::report(func, count, max, cx);
        }
    }
}

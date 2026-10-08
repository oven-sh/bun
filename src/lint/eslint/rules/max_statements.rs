use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint::utils::{ast_utils, text};
use smallvec::SmallVec;

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

/// With `ignoreTopLevelFunctions`, the functions that are in no other function or static block.
#[derive(Default)]
pub struct TopLevelFunctions<'a> {
    count: usize,
    /// Those with too many statements, and how many.
    exceeding: Vec<(Func<'a>, usize)>,
    /// What is in a function or a static block.
    enclosed: AncestorMemo<'a, ()>,
}

fn may_contain_blocks(statement: &Stmt) -> bool {
    matches!(
        statement.tag(),
        StmtTag::Block
            | StmtTag::If
            | StmtTag::For
            | StmtTag::ForIn
            | StmtTag::ForOf
            | StmtTag::While
            | StmtTag::DoWhile
            | StmtTag::Labeled
            | StmtTag::Switch
            | StmtTag::Try
            | StmtTag::Module
    )
}

/// The sum of the lengths of the `BlockStatement`s of `func`, without those of the functions and
/// the static blocks in it.
fn count_statements(func: Func) -> usize {
    let Some(body) = func.body_statements() else {
        return 0;
    };
    let mut count = body.len();
    let mut pending: SmallVec<[Stmt; 16]> = body.iter().filter(may_contain_blocks).collect();
    while let Some(statement) = pending.pop() {
        match statement.kind() {
            StmtKind::Block(statements) => {
                count += statements.len();
                pending.extend(statements.iter().filter(may_contain_blocks));
            }
            StmtKind::If { yes, no, .. } => pending.extend([Some(yes), no].into_iter().flatten()),
            StmtKind::For { body, .. }
            | StmtKind::ForIn { body, .. }
            | StmtKind::ForOf { body, .. }
            | StmtKind::While { body, .. }
            | StmtKind::DoWhile { body, .. }
            | StmtKind::With { body, .. }
            | StmtKind::Labeled { body, .. } => pending.push(body),
            StmtKind::Switch { cases, .. } => {
                for case in cases {
                    pending.extend(case.body().iter().filter(may_contain_blocks));
                }
            }
            StmtKind::Try {
                block,
                handler,
                finalizer,
                ..
            } => pending.extend([Some(block), handler, finalizer].into_iter().flatten()),
            StmtKind::Module(module) => {
                pending.extend(module.innermost().body().iter().filter(may_contain_blocks));
            }
            _ => {}
        }
    }
    count
}

impl MaxStatements {
    fn report<'a>(func: Func<'a>, count: usize, max: usize, cx: &Cx<'a, Self>) {
        let name = ast_utils::get_function_name_with_kind(func);
        cx.report(ast_utils::get_function_head_loc(func), EXCEED)
            .data("name", text::upper_case_first(&name).into_owned())
            .data("count", count)
            .data("max", max);
    }

    fn check<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
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
        let count = count_statements(func);
        if count <= max {
            return;
        }
        match is_top_level {
            true => cx.state.exceeding.push((func, count)),
            false => Self::report(func, count, max, cx),
        }
    }

    /// A single top level function is taken for the wrapper of a module.
    fn check_top_level_functions<'a>(&self, cx: &mut Cx<'a, Self>) {
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

impl Rule for MaxStatements {
    const META: Meta = Meta::eslint("max-statements", Kind::Suggestion);
    type State<'a> = TopLevelFunctions<'a>;

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

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> TopLevelFunctions<'a> {
        on.funcs(Self::check);
        if self.ignore_top_level_functions {
            on.finish(Self::check_top_level_functions);
        }
        TopLevelFunctions::default()
    }
}

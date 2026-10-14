use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::types::IdMap;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Disallows the use of `this` in exported functions.
pub struct NoThisInExportedFunction;

const NO_THIS_IN_EXPORTED_FUNCTION: Message = Message::new("", "`this` should not be used in exported functions");

#[derive(Default)]
pub struct State<'a> {
    /// The function in whose body something is, if a `this` there is that of the function.
    functions: AncestorMemo<'a, Option<Func<'a>>>,
    /// How often a function is exported.
    exports: IdMap<Func<'a>, usize>,
    /// Where the function declarations and the function expressions are, without those in another, in order. No other function
    /// is exported.
    candidates: Vec<Span>,
}

impl Rule for NoThisInExportedFunction {
    const META: Meta = Meta::oxlint(Plugin::Oxc, "no-this-in-exported-function", Kind::Problem);
    const ON: On = On::new().exprs(&[ExprTag::This]);
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        NoThisInExportedFunction
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        if !file.has_stmts([StmtTag::ExportNamed]) && !file.stmts_of_kind(StmtTag::Fn).any(Stmt::is_exported) {
            return None;
        }
        let functions = file.funcs().filter(|it| matches!(it.kind(), FnKind::Decl | FnKind::Expr) && it.has_body());
        let mut candidates: Vec<Span> = functions.map(Func::span).collect();
        utils::sort::sort_unstable_by_key(&mut candidates, |it| it.start);
        let mut end = 0;
        candidates.retain(|it| {
            let is_in_no_other = it.start >= end;
            end = end.max(it.end);
            is_in_no_other
        });
        (!candidates.is_empty()).then(|| State { candidates, ..State::default() })
    }

    fn expr<'a>(&self, this: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let start = this.span().start;
        let before = cx.state.candidates.partition_point(|it| it.start <= start);
        if !before.checked_sub(1).and_then(|it| cx.state.candidates.get(it)).is_some_and(|it| start < it.end) || this.is_in_type_query() {
            return;
        }
        let Some(Some(func)) = cx.state.functions.find(Node::Expr(this), function_of_this) else {
            return;
        };
        // It is reported for each export.
        let count = *cx.state.exports.get_or_insert_with(func, || export_count(func));
        for _ in 0..count {
            cx.report(this, NO_THIS_IN_EXPORTED_FUNCTION);
        }
    }
}

/// `ThisExpressionFinder`, from the inside: not in another function that is not an arrow function, nor in its parameters, not in a
/// static block, not in the value or a decorator of a property of a class.
fn function_of_this<'a>(child: Node<'a>, parent: Node<'a>) -> Option<Option<Func<'a>>> {
    match parent {
        Node::Func(func) => match func.kind() {
            FnKind::Arrow => None,
            FnKind::StaticBlock => Some(None),
            _ => Some(matches!(child, Node::Stmt(_)).then_some(func)),
        },
        Node::Member(member) if member.kind() == MemberKind::Property && !member.flags().contains(Flags::ACCESSOR) => {
            match (child, member.key().map(Key::kind)) {
                (Node::Expr(e), Some(KeyKind::Computed(key))) if e == key => None,
                _ => Some(None),
            }
        }
        _ => None,
    }
}

fn export_count<'a>(func: Func<'a>) -> usize {
    match func.owner() {
        Node::Stmt(statement) => {
            let is_first = |symbol: &Symbol<'a>| matches!(symbol.declarations().next(), Some(Declaration::Fn(first)) if first == func);
            usize::from(statement.is_exported()) + func.symbol().filter(is_first).map_or(0, export_specifier_count)
        }
        Node::Expr(e) if func.kind() == FnKind::Expr && !e.is_parenthesized() => {
            let Node::VarDecl(declarator) = e.parent() else {
                return 0;
            };
            let mut count = 0;
            declarator.pat().for_each_binding(&mut |pat| {
                if let Some(symbol) = pat.symbol()
                    && symbol.declarations().next().and_then(Declaration::node) == Some(Node::VarDecl(declarator))
                {
                    count += export_specifier_count(symbol);
                }
            });
            count
        }
        _ => 0,
    }
}

/// How many `export { a }` there are for it, without `type`.
fn export_specifier_count(symbol: Symbol) -> usize {
    let is_export = |it: &Reference| matches!(it.node(), Node::ExportSpec(spec) if !spec.is_type_only() && !spec.export().is_type_only());
    symbol.references().filter(is_export).count()
}

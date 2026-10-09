use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use rustc_hash::FxHashMap;

/// Disallows the use of `this` in exported functions.
pub struct NoThisInExportedFunction;

const NO_THIS_IN_EXPORTED_FUNCTION: Message = Message::new("", "`this` should not be used in exported functions");

#[derive(Default)]
pub struct State<'a> {
    /// The function in whose body something is, if a `this` there is that of the function.
    functions: AncestorMemo<'a, Option<Func<'a>>>,
    /// How often a function is exported.
    exports: FxHashMap<Func<'a>, usize>,
}

impl Rule for NoThisInExportedFunction {
    const META: Meta = Meta::oxlint(Plugin::Oxc, "no-this-in-exported-function", Kind::Problem);
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        NoThisInExportedFunction
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Self::State<'a> {
        if file.has_exprs([ExprTag::This])
            && (file.has_stmts([StmtTag::ExportNamed]) || file.stmts_of_kind(StmtTag::Fn).any(Stmt::is_exported))
        {
            on.exprs([ExprTag::This], |_, this, cx| {
                if this.is_in_type_query() {
                    return;
                }
                let Some(Some(func)) = cx.state.functions.find(Node::Expr(this), function_of_this) else {
                    return;
                };
                // It is reported for each export.
                for _ in 0..*cx.state.exports.entry(func).or_insert_with(|| export_count(func)) {
                    cx.report(this, NO_THIS_IN_EXPORTED_FUNCTION);
                }
            });
        }
        State::default()
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

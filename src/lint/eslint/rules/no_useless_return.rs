use bun_lint::prelude::*;
use bun_lint::utils::fix_tracker::FixTracker;
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

/// Disallow redundant return statements.
pub struct NoUselessReturn;

const UNNECESSARY_RETURN: Message =
    Message::new("unnecessaryReturn", "Unnecessary return statement.");

type Returns<'a> = SmallVec<[Stmt<'a>; 2]>;
/// By `Segment::id`. Only reachable segments have an entry.
type SegmentInfoMap<'a> = FxHashMap<u32, SegmentInfo<'a>>;

struct SegmentInfo<'a> {
    useless_returns: Returns<'a>,
    is_returned: bool,
}

struct ScopeInfo<'a> {
    code_path: CodePath<'a>,
    /// Whether there can be a `return` without a value in it. If not, nothing is kept about it.
    is_active: bool,
    useless_returns: Vec<Stmt<'a>>,
    /// The `block` of each `try` statement around the current node that has been left.
    traversed_try_blocks: Vec<Span>,
}

#[derive(Default)]
pub struct State<'a> {
    /// For each of the code paths around the current node, the innermost last.
    scopes: Vec<ScopeInfo<'a>>,
    segments: SegmentInfoMap<'a>,
}

/// ESLint's `isReturned`: `segment` ends with a `return`, or it is unreachable.
fn is_returned<'a>(segments: &SegmentInfoMap<'a>, segment: Segment<'a>) -> bool {
    segments.get(&segment.id()).is_none_or(|info| info.is_returned)
}

/// ESLint's `isInFinally`.
fn is_in_finally(statement: Stmt<'_>) -> bool {
    let mut current = Node::Stmt(statement);
    for parent in current.ancestors() {
        if let Node::Stmt(parent) = parent
            && matches!(
                parent.kind(),
                StmtKind::Try { finalizer: Some(finalizer), .. } if Node::Stmt(finalizer) == current
            )
        {
            return true;
        }
        if ast_utils::is_function(parent) {
            return false;
        }
        current = parent;
    }
    false
}

impl<'a> State<'a> {
    /// ESLint's `getUselessReturns`, for the segments before `segment`. An unreachable one that
    /// comes after a `return` stands for those before it, as if the `return` was not there.
    fn get_useless_returns(&self, segment: Segment<'a>) -> Returns<'a> {
        let mut useless_returns = Returns::new();
        let mut traversed: SmallVec<[u32; 8]> = SmallVec::new();
        let mut pending = segment.all_prev_segments();
        while let Some(prev) = pending.pop() {
            if prev.is_reachable() {
                if let Some(info) = self.segments.get(&prev.id()) {
                    useless_returns.extend_from_slice(&info.useless_returns);
                }
            } else if !traversed.contains(&prev.id()) {
                traversed.push(prev.id());
                let before = prev.all_prev_segments();
                pending.extend(before.into_iter().filter(|it| is_returned(&self.segments, *it)));
            }
        }
        useless_returns
    }

    /// ESLint's `markReturnStatementsOnCurrentSegmentsAsUsed`, for the code path at `index` of
    /// `scopes`.
    fn mark_return_statements_on_current_segments_as_used(&mut self, index: usize) {
        let Some(scope) = self.scopes.get_mut(index) else {
            return;
        };
        if scope.useless_returns.is_empty() {
            return;
        }
        let mut used_unreachable: SmallVec<[u32; 8]> = SmallVec::new();
        let mut pending = scope.code_path.current_segments();
        while let Some(segment) = pending.pop() {
            if !segment.is_reachable() {
                if !used_unreachable.contains(&segment.id()) {
                    used_unreachable.push(segment.id());
                    let before = segment.all_prev_segments();
                    pending.extend(before.into_iter().filter(|it| is_returned(&self.segments, *it)));
                }
                continue;
            }
            let Some(info) = self.segments.get_mut(&segment.id()) else {
                continue;
            };
            info.useless_returns.retain(|statement| {
                let span = statement.span();
                if scope.traversed_try_blocks.iter().any(|block| block.contains(span)) {
                    return true;
                }
                if let Some(at) = scope.useless_returns.iter().position(|it| *it == *statement) {
                    scope.useless_returns.remove(at);
                }
                false
            });
        }
    }

    /// A `return` without a value.
    fn add_return(&mut self, statement: Stmt<'a>) {
        let Some(scope) = self.scopes.last_mut() else {
            return;
        };
        if !scope.is_active
            || !scope.code_path.is_current_reachable()
            || ast_utils::is_in_loop(statement)
            || is_in_finally(statement)
        {
            return;
        }
        for segment in scope.code_path.current_segments() {
            if let Some(info) = self.segments.get_mut(&segment.id()) {
                info.useless_returns.push(statement);
                info.is_returned = true;
            }
        }
        scope.useless_returns.push(statement);
    }
}

impl NoUselessReturn {
    fn enter_statement<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        let Node::Stmt(statement) = node else {
            return;
        };
        let innermost = cx.state.scopes.len().wrapping_sub(1);
        let scope = match statement.kind() {
            StmtKind::Return(None) => {
                cx.state.add_return(statement);
                return;
            }
            StmtKind::Block(_) => return,
            // These only count for the `export` around them, which is outside the code path of a
            // function.
            StmtKind::Fn(_)
            | StmtKind::Interface(_)
            | StmtKind::TypeAlias(_)
            | StmtKind::Enum(_)
            | StmtKind::Module(_)
            | StmtKind::ImportEquals(_)
                if !statement.is_exported() =>
            {
                return;
            }
            StmtKind::Fn(func) if func.has_body() => innermost.wrapping_sub(1),
            _ => innermost,
        };
        cx.state.mark_return_statements_on_current_segments_as_used(scope);
    }

    fn exit_statement<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        let (Node::Stmt(statement), Some(scope)) = (node, cx.state.scopes.last_mut()) else {
            return;
        };
        if !scope.is_active {
            return;
        }
        match statement.kind() {
            StmtKind::Try { .. } => {
                scope.traversed_try_blocks.pop();
            }
            StmtKind::Block(_) => {
                if let Node::Stmt(parent) = statement.parent()
                    && matches!(parent.kind(), StmtKind::Try { block, .. } if block == statement)
                {
                    scope.traversed_try_blocks.push(statement.span());
                }
            }
            _ => {}
        }
    }
}

impl Rule for NoUselessReturn {
    const META: Meta = Meta::eslint("no-useless-return", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        NoUselessReturn
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> State<'a> {
        let mut returns = file.stmts_of_kind(StmtTag::Return);
        if !returns.any(|it| matches!(it.kind(), StmtKind::Return(None))) {
            return State::default();
        }
        on.code_path_start(|_, code_path, node, cx| {
            cx.state.scopes.push(ScopeInfo {
                code_path,
                is_active: match node {
                    Node::File(_) => true,
                    Node::Func(func) => {
                        func.returns().any(|it| matches!(it.kind(), StmtKind::Return(None)))
                    }
                    _ => false,
                },
                useless_returns: Vec::new(),
                traversed_try_blocks: Vec::new(),
            });
        });
        on.code_path_end(|_, _, _, cx| {
            let Some(scope) = cx.state.scopes.pop() else {
                return;
            };
            for statement in scope.useless_returns {
                cx.report(statement, UNNECESSARY_RETURN).fix(|fixer| {
                    let is_removable = ast_utils::is_statement_list_parent(statement.parent())
                        && fixer.file().comments_in(statement).next().is_none();
                    // The whole function, so that this does not conflict with `no-else-return`.
                    is_removable.then(|| {
                        FixTracker::new(fixer).retain_enclosing_function(statement).remove(statement)
                    })
                });
            }
        });
        on.segment_start(|_, segment, _, cx| {
            if cx.state.scopes.last().is_some_and(|scope| scope.is_active) {
                let useless_returns = cx.state.get_useless_returns(segment);
                cx.state.segments.insert(
                    segment.id(),
                    SegmentInfo {
                        useless_returns,
                        is_returned: false,
                    },
                );
            }
        });
        on.enter(
            [
                StmtTag::Return,
                StmtTag::Class,
                StmtTag::Continue,
                StmtTag::Debugger,
                StmtTag::DoWhile,
                StmtTag::Empty,
                StmtTag::Expr,
                StmtTag::ForIn,
                StmtTag::ForOf,
                StmtTag::For,
                StmtTag::If,
                StmtTag::Import,
                StmtTag::Labeled,
                StmtTag::Switch,
                StmtTag::Throw,
                StmtTag::Try,
                StmtTag::Var,
                StmtTag::While,
                // A `with` statement.
                StmtTag::Block,
                StmtTag::ExportNamed,
                StmtTag::ExportDefault,
                StmtTag::ExportStar,
                // These only with an `export`.
                StmtTag::Fn,
                StmtTag::Interface,
                StmtTag::TypeAlias,
                StmtTag::Enum,
                StmtTag::Module,
                StmtTag::ImportEquals,
            ],
            Self::enter_statement,
        );
        on.exit([StmtTag::Block, StmtTag::Try], Self::exit_statement);
        State::default()
    }
}

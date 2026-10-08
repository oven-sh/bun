use bun_lint::code_path::{Event, Step};
use bun_lint::prelude::*;
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

/// Require `super()` calls in constructors.
pub struct ConstructorSuper;

const MISSING_SOME: Message =
    Message::new("missingSome", "Lacked a call of 'super()' in some code paths.");
const MISSING_ALL: Message = Message::new("missingAll", "Expected to call 'super()'.");
const DUPLICATE: Message = Message::new("duplicate", "Unexpected duplicate 'super()'.");
const BAD_SUPER: Message = Message::new(
    "badSuper",
    "Unexpected 'super()' because 'super' is not a constructor.",
);

/// ESLint's `isPossibleConstructor`
fn is_possible_constructor(mut e: Expr<'_>) -> bool {
    if !bun_core::StackCheck::init().is_safe_to_recurse() {
        return true;
    }
    loop {
        if utils::is_chain_root(e) {
            return true;
        }
        e = match e.kind() {
            ExprKind::Class(_)
            | ExprKind::This
            | ExprKind::Dot { .. }
            | ExprKind::Index { .. }
            | ExprKind::Call(_)
            | ExprKind::New(_)
            | ExprKind::Yield { .. }
            | ExprKind::TaggedTemplate(_)
            | ExprKind::ImportMeta
            | ExprKind::NewTarget => return true,
            ExprKind::Fn(func) => return !func.is_arrow(),
            ExprKind::Ident(name) => return !name.is("undefined"),
            ExprKind::Assign { op, target, value } => match op {
                None | Some(BinOp::And) => value,
                Some(BinOp::Or | BinOp::Nullish) if is_possible_constructor(target) => return true,
                Some(BinOp::Or | BinOp::Nullish) => value,
                // The result of arithmetic is a primitive value.
                Some(_) => return false,
            },
            ExprKind::Binary { op, left, right } => match op {
                // If `&&` yields its left side, that is falsy.
                BinOp::And | BinOp::Comma => right,
                BinOp::Or | BinOp::Nullish if is_possible_constructor(right) => return true,
                BinOp::Or | BinOp::Nullish => left,
                _ => return false,
            },
            ExprKind::Cond { yes, .. } if is_possible_constructor(yes) => return true,
            ExprKind::Cond { no, .. } => no,
            _ => return false,
        };
    }
}

/// The first statement directly in the body of `constructor` that is a `super(..)` and nothing else,
/// with what precedes it and the call.
pub fn first_super_statement<'a>(constructor: Func<'a>) -> Option<(impl Iterator<Item = Stmt<'a>>, Call<'a>)> {
    let body = constructor.body_statements()?;
    let (at, call) = body.iter().enumerate().find_map(|(at, statement)| match statement.kind() {
        StmtKind::Expr(e) => e.as_call().filter(|call| call.callee().tag() == ExprTag::Super).map(|call| (at, call)),
        _ => None,
    })?;
    Some((body.iter().take(at), call))
}

/// Whether it can be told from the statements of the body alone that `super()` is called exactly
/// once on every way through `constructor`: it is a statement of its own there, no `return`
/// precedes it, and there is no other. One in a function or in the constructor of a class in it is not its own.
/// Not if there is a loop: see [`ConstructorSuper::on_segment_start`].
fn calls_super_plainly<'a>(constructor: Func<'a>, cx: &mut Cx<'a, ConstructorSuper>) -> bool {
    let Some((_, call)) = first_super_statement(constructor) else {
        return false;
    };
    let (file, callee, whole) = (constructor.file(), call.callee(), constructor.span());
    if !constructor.returns().all(|it| it.span().start > callee.span().start) {
        return false;
    }
    let loops = cx.state.loops.get_or_insert_with(|| {
        let tags = [StmtTag::DoWhile, StmtTag::While, StmtTag::For, StmtTag::ForIn, StmtTag::ForOf];
        let statements = tags.into_iter().flat_map(|tag| file.stmts_of_kind(tag));
        let mut loops: Vec<u32> = statements.map(|it| it.span().start).collect();
        loops.sort_unstable();
        loops
    });
    if loops.get(loops.partition_point(|&it| it < whole.start)).is_some_and(|&it| it < whole.end) {
        return false;
    }
    let callees = cx.state.super_callees.get_or_insert_with(|| {
        let mut callees: Vec<_> = file.exprs_of_kind(ExprTag::Super).filter(|&e| ast_utils::is_callee(e)).collect();
        callees.sort_unstable_by_key(|e| e.span().start);
        callees
    });
    let mut rest = callees.get(callees.partition_point(|e| e.span().start < whole.start)..).unwrap_or_default();
    while let Some((&e, after)) = rest.split_first()
        && e.span().start < whole.end
    {
        rest = match Node::Expr(e).enclosing_function() {
            Some(function) if function == constructor && e == callee => after,
            // All that is in a function in it is passed over at once.
            Some(function) if function != constructor => {
                let end = function.span().end;
                after.get(after.partition_point(|it| it.span().start < end)..).unwrap_or_default()
            }
            _ => return false,
        };
    }
    true
}

fn is_update_of_for(node: Node<'_>) -> bool {
    let (Node::Expr(e), Node::Stmt(parent)) = (node, node.parent()) else {
        return false;
    };
    matches!(parent.kind(), StmtKind::For { update, .. } if update == Some(e))
}

/// On which of the paths that lead through a segment `super()` is called.
#[derive(Copy, Clone, Default)]
struct Called {
    in_every_path: bool,
    in_some_paths: bool,
}

struct SegmentInfo<'a> {
    called: Called,
    /// The `super()` calls that have been found valid, which a loop can make duplicates.
    valid_nodes: SmallVec<[Expr<'a>; 1]>,
}

struct FuncInfo<'a> {
    /// It is the constructor of a class that has an `extends`.
    has_extends: bool,
    super_is_constructor: bool,
    code_path: CodePath<'a>,
}

#[derive(Default)]
pub struct State<'a> {
    /// The constructor that is checked. Those of the classes in it are checked on their own.
    constructor: Option<Func<'a>>,
    /// For each of the code paths around the current node, the innermost last.
    func_infos: Vec<FuncInfo<'a>>,
    /// By `Segment::id`, for the segments of the constructors that are checked.
    seg_info_map: FxHashMap<u32, SegmentInfo<'a>>,
    /// The `super` of each `super()` of the file, in source order, once a constructor asks.
    super_callees: Option<Vec<Expr<'a>>>,
    /// Where the loops of the file start, in ascending order, once a constructor asks.
    loops: Option<Vec<u32>>,
}

impl<'a> State<'a> {
    /// The innermost code path, if it is one to check.
    fn constructor(&self) -> Option<&FuncInfo<'a>> {
        self.func_infos.last().filter(|it| it.has_extends)
    }

    fn is_called_in_some_path(&self, segment: Segment<'a>) -> bool {
        segment.is_reachable()
            && self.seg_info_map.get(&segment.id()).is_some_and(|it| it.called.in_some_paths)
    }

    fn is_called_in_every_path(&self, segment: Segment<'a>) -> bool {
        segment.is_reachable()
            && self.seg_info_map.get(&segment.id()).is_some_and(|it| it.called.in_every_path)
    }

    /// Of the segments before `segment` that have been seen: whether there are any, and whether
    /// `super()` is called in some of them and in all of them.
    fn seen_prev_segments(&self, segment: Segment<'a>) -> (bool, Called) {
        let (mut any, mut some, mut every) = (false, false, true);
        for prev in segment.prev_segments() {
            if self.seg_info_map.contains_key(&prev.id()) {
                any = true;
                some |= self.is_called_in_some_path(prev);
                every &= self.is_called_in_every_path(prev);
            }
        }
        let called = Called {
            in_every_path: every,
            in_some_paths: some,
        };
        (any, called)
    }

    /// Marks the current segments that are reachable as having called `super()`. Returns the id of
    /// the last of them, and whether one of them had called it before.
    fn mark_current_segments(&mut self, code_path: CodePath<'a>) -> (Option<u32>, bool) {
        let (mut last, mut is_duplicate) = (None, false);
        for segment in code_path.current_segments() {
            if segment.is_reachable()
                && let Some(info) = self.seg_info_map.get_mut(&segment.id())
            {
                is_duplicate |= info.called.in_some_paths;
                info.called = Called {
                    in_every_path: true,
                    in_some_paths: true,
                };
                last = Some(segment.id());
            }
        }
        (last, is_duplicate)
    }
}

impl ConstructorSuper {
    fn check_constructor<'a>(&self, constructor: Func<'a>, cx: &mut Cx<'a, Self>) {
        cx.state.constructor = Some(constructor);
        for step in constructor.code_path_steps(StmtTag::Return, ExprTag::Call) {
            match step {
                Step::Event(Event::CodePathStart(path, node)) => self.on_code_path_start(path, node, cx),
                Step::Event(Event::CodePathEnd(path, node)) => self.on_code_path_end(path, node, cx),
                Step::Event(Event::SegmentStart(segment, node)) => self.on_segment_start(segment, node, cx),
                Step::Event(Event::SegmentLoop(from, to, node)) => self.on_segment_loop(from, to, node, cx),
                Step::Event(_) => {}
                Step::Enter(node) => self.on_return(node, cx),
                Step::Exit(node) => self.on_call_exit(node, cx),
            }
        }
        cx.state.seg_info_map.clear();
    }

    fn on_code_path_start<'a>(&self, code_path: CodePath<'a>, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        let super_class = match node {
            // `static constructor() {}` is a method.
            Node::Func(func)
                if cx.state.constructor == Some(func)
                    && func.kind() == FnKind::Constructor
                    && !func.flags().contains(Flags::STATIC) =>
            {
                match func.owner().parent() {
                    Node::Class(class) => class.extends(),
                    _ => None,
                }
            }
            _ => None,
        };
        cx.state.func_infos.push(FuncInfo {
            has_extends: super_class.is_some(),
            super_is_constructor: super_class.is_some_and(is_possible_constructor),
            code_path,
        });
    }

    fn on_code_path_end<'a>(&self, code_path: CodePath<'a>, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        let (Some(FuncInfo { has_extends: true, .. }), Node::Func(func)) = (cx.state.func_infos.pop(), node)
        else {
            return;
        };
        let returned_segments = code_path.returned_segments();
        if returned_segments.iter().all(|it| cx.state.is_called_in_every_path(*it)) {
            return;
        }
        let called_in_some_paths = returned_segments.iter().any(|it| cx.state.is_called_in_some_path(*it));
        cx.report(func.owner(), if called_in_some_paths { MISSING_SOME } else { MISSING_ALL });
    }

    fn on_segment_start<'a>(&self, segment: Segment<'a>, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        if cx.state.constructor().is_none() {
            return;
        }
        // As upstream, it has been seen before those before it are looked at. One of them is itself if it is all of a loop,
        // as in `do { a(); } while (b);`: then `super()` is never called on every path to it, and to what follows.
        let unknown = SegmentInfo {
            called: Called::default(),
            valid_nodes: SmallVec::new(),
        };
        cx.state.seg_info_map.insert(segment.id(), unknown);
        let (any, before) = cx.state.seen_prev_segments(segment);
        if let Some(info) = cx.state.seg_info_map.get_mut(&segment.id()) {
            info.called = Called {
                // The segment of the update of a `for` is made in advance, before what precedes it is
                // seen. It is never the only one before another: this makes the others decide.
                in_every_path: any && before.in_every_path || is_update_of_for(node),
                in_some_paths: any && before.in_some_paths,
            };
        }
    }

    fn on_segment_loop<'a>(
        &self,
        from_segment: Segment<'a>,
        to_segment: Segment<'a>,
        _: Node<'a>,
        cx: &mut Cx<'a, Self>,
    ) {
        let Some(code_path) = cx.state.constructor().map(|it| it.code_path) else {
            return;
        };
        code_path.traverse_segments_between(Some(to_segment), Some(from_segment), |segment, controller| {
            let (_, before) = cx.state.seen_prev_segments(segment);
            // What has not been seen is after the loop.
            let Some(info) = cx.state.seg_info_map.get_mut(&segment.id()) else {
                controller.skip();
                return;
            };
            info.called = Called {
                in_every_path: info.called.in_every_path || before.in_every_path,
                in_some_paths: info.called.in_some_paths || before.in_some_paths,
            };
            if before.in_some_paths {
                for node in std::mem::take(&mut info.valid_nodes) {
                    cx.report(node, DUPLICATE);
                }
            }
        });
    }

    fn on_call_exit<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        let Node::Expr(e) = node else {
            return;
        };
        if !e.as_call().is_some_and(|call| call.callee().tag() == ExprTag::Super) {
            return;
        }
        let Some(&FuncInfo {
            code_path,
            super_is_constructor,
            ..
        }) = cx.state.constructor()
        else {
            return;
        };
        let (Some(last), is_duplicate) = cx.state.mark_current_segments(code_path) else {
            return;
        };
        if is_duplicate {
            cx.report(e, DUPLICATE);
        } else if !super_is_constructor {
            cx.report(e, BAD_SUPER);
        } else if let Some(info) = cx.state.seg_info_map.get_mut(&last) {
            info.valid_nodes.push(e);
        }
    }

    /// Returning a value is a substitute for `super()`.
    fn on_return<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        if let Node::Stmt(statement) = node
            && let StmtKind::Return(Some(_)) = statement.kind()
            && let Some(code_path) = cx.state.constructor().map(|it| it.code_path)
        {
            cx.state.mark_current_segments(code_path);
        }
    }
}

impl Rule for ConstructorSuper {
    const META: Meta = Meta::eslint("constructor-super", Kind::Problem).recommended();
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        ConstructorSuper
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> State<'a> {
        on.classes(|rule, class, cx| {
            let Some(super_class) = class.extends() else {
                return;
            };
            let constructors = class.members().iter().filter(|it| it.kind() == MemberKind::Constructor);
            for constructor in constructors.filter_map(Member::func).filter(|it| it.has_body()) {
                if !(is_possible_constructor(super_class) && calls_super_plainly(constructor, cx)) {
                    rule.check_constructor(constructor, cx);
                }
            }
        });
        State::default()
    }
}

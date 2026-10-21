use super::constructor_super::first_super_statement;
use bun_core::strings;
use bun_lint::code_path::{Event, Step};
use bun_lint::prelude::*;
use bun_lint_oxlint::ast_util::plain;
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;

/// Disallow `this`/`super` before calling `super()` in constructors.
pub struct NoThisBeforeSuper;

const NO_BEFORE_SUPER: Message =
    Message::new("noBeforeSuper", "'{{kind}}' is not allowed before 'super()'.");

#[derive(Default)]
struct SegmentInfo<'a> {
    /// `super()` is called in all code paths.
    super_called: bool,
    /// The invalid `this` and `super`.
    invalid_nodes: SmallVec<[Expr<'a>; 1]>,
}

struct FuncInfo<'a> {
    /// True for the constructor of a class that has a valid `extends`.
    is_constructor_of_derived_class: bool,
    code_path: CodePath<'a>,
}

#[derive(Default)]
pub struct State<'a> {
    /// The constructor being checked. The constructors of classes nested in it are checked separately.
    constructor: Option<Func<'a>>,
    /// One for each code path enclosing the current node, innermost last.
    func_infos: Vec<FuncInfo<'a>>,
    /// Keyed by `Segment::id`, for the segments of the constructor being checked.
    seg_info_map: FxHashMap<u32, SegmentInfo<'a>>,
    /// The result of `switches_with_early_default`, computed on first use.
    switches_with_early_default: Option<Vec<u32>>,
    /// Only under an oxlint config: the number of enclosing `super()` calls that have the current node in their
    /// arguments and that oxlint already counts as called.
    enclosing_called_supers: u32,
}

impl<'a> State<'a> {
    /// ESLint's `isInConstructorOfDerivedClass`: returns the innermost code path if it needs checking.
    fn constructor_of_derived_class(&self) -> Option<CodePath<'a>> {
        let innermost = self.func_infos.last()?;
        innermost.is_constructor_of_derived_class.then_some(innermost.code_path)
    }

    fn is_called(&self, segment: Segment<'a>) -> bool {
        !segment.is_reachable() || self.seg_info_map.get(&segment.id()).is_some_and(|it| it.super_called)
    }

    /// `segment.prevSegments.length > 0 && segment.prevSegments.every(isCalled)`
    fn is_called_before(&self, segment: Segment<'a>) -> bool {
        let prev_segments = segment.prev_segments();
        !prev_segments.is_empty() && prev_segments.iter().all(|it| self.is_called(*it))
    }

    /// ESLint's `isBeforeCallOfSuper`: returns the reachable current segments, if this is a constructor to check and
    /// `super()` hasn't been called yet in all of its current segments.
    fn segments_before_call_of_super(&self) -> Option<SmallVec<[Segment<'a>; 2]>> {
        let mut segments = self.constructor_of_derived_class()?.current_segments();
        if segments.iter().all(|it| self.is_called(*it)) {
            return None;
        }
        segments.retain(|it| it.is_reachable());
        Some(segments)
    }
}

/// oxlint's `contains_this_or_super_in_args`: true if an argument is `this` or `super`, a member of one, or a call
/// whose callee is either of those or whose arguments match in turn.
fn oxlint_contains_this_or_super<'a>(args: List<'a, Expr<'a>>) -> bool {
    if !bun_core::StackCheck::init().is_safe_to_recurse() {
        return false;
    }
    let is_either = |e: Expr<'_>| matches!(plain(e).map(Expr::tag), Some(ExprTag::This | ExprTag::Super));
    let is_member_of_either = |e: Expr<'_>| matches!(plain(e).map(Expr::kind), Some(ExprKind::Dot { obj, .. }) if is_either(obj));
    args.iter().any(|arg| {
        is_either(arg)
            || is_member_of_either(arg)
            || plain(arg).and_then(Expr::as_call).is_some_and(|call| {
                let callee = call.callee();
                is_either(callee) || is_member_of_either(callee) || oxlint_contains_this_or_super(call.args())
            })
    })
}

/// True if there's a `this` or a `super` in `node`.
fn has_this_or_super(node: Node<'_>) -> bool {
    let mut todo = vec![node];
    while let Some(node) = todo.pop() {
        if matches!(node, Node::Expr(e) if matches!(e.tag(), ExprTag::This | ExprTag::Super)) {
            return true;
        }
        node.for_each_child(|child| todo.push(child));
    }
    false
}

/// True if the source has neither word between the start of `constructor` and the last argument of `call`, not counting
/// the callee.
fn has_neither_word_up_to(constructor: Func<'_>, call: Call<'_>) -> bool {
    let (file, callee) = (constructor.file(), call.callee().span());
    let end = call.args().last().map_or(callee.end, |it| it.outer_span().end);
    let before = file.slice(Span::new(constructor.span().start, callee.start));
    let after = file.slice(Span::new(callee.end, end));
    [before, after].iter().all(|it| !strings::contains(it, b"this") && !strings::contains(it, b"super"))
}

/// Fast path that skips the code path analysis: true if `super()` is a top-level statement of the body, and there's no
/// `this` or `super` in the parameters, the signature's types, the statements before it, or its arguments.
fn calls_super_first(constructor: Func<'_>) -> bool {
    first_super_statement(constructor).is_some_and(|(mut before, call)| {
        has_neither_word_up_to(constructor, call)
            || !constructor.params().iter().any(|it| has_this_or_super(it.into()))
                && !constructor.type_params().iter().any(|it| has_this_or_super(it.into()))
                && !constructor.return_type().is_some_and(|it| has_this_or_super(it.into()))
                && !before.any(|it| has_this_or_super(it.into()))
                && !call.args().iter().any(|it| has_this_or_super(it.into()))
    })
}

/// Returns the sorted start offsets of the `switch` statements whose `default` isn't the last case. Where such a
/// statement is unreachable, ESLint still creates a reachable segment without predecessors, so `super()` isn't called
/// before it.
fn switches_with_early_default<'a>(file: &'a File<'a>) -> Vec<u32> {
    let has_early_default = |statement: &Stmt| match statement.kind() {
        StmtKind::Switch { cases, .. } => {
            cases.iter().position(|it| it.test().is_none()).is_some_and(|at| at + 1 < cases.len())
        }
        _ => false,
    };
    let with_early_default = file.stmts_of_kind(StmtTag::Switch).filter(has_early_default);
    let mut starts: Vec<u32> = with_early_default.map(|it| it.span().start).collect();
    starts.sort_unstable();
    starts
}

impl NoThisBeforeSuper {
    fn has_switch_with_early_default<'a>(constructor: Func<'a>, cx: &mut Cx<'a, Self>) -> bool {
        let file = cx.file();
        if !file.has_stmts([StmtTag::Switch]) {
            return false;
        }
        let starts = cx.state.switches_with_early_default.get_or_insert_with(|| switches_with_early_default(file));
        let span = constructor.span();
        starts.get(starts.partition_point(|&it| it < span.start)).is_some_and(|&it| it < span.end)
    }

    fn check_constructor<'a>(&self, constructor: Func<'a>, cx: &mut Cx<'a, Self>) {
        cx.state.constructor = Some(constructor);
        for step in constructor.code_path_steps([ExprTag::This, ExprTag::Super], ExprTag::Call) {
            match step {
                Step::Event(Event::CodePathStart(path, node)) => self.on_code_path_start(path, node, cx),
                Step::Event(Event::CodePathEnd(path, node)) => self.on_code_path_end(path, node, cx),
                Step::Event(Event::SegmentStart(segment, node)) => self.on_segment_start(segment, node, cx),
                Step::Event(_) => {}
                Step::Enter(node) => self.on_this_or_super(node, cx),
                Step::Exit(node) => self.on_call_exit(node, cx),
            }
        }
        cx.state.seg_info_map.clear();
        cx.state.enclosing_called_supers = 0;
    }

    fn on_code_path_start<'a>(&self, code_path: CodePath<'a>, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        let is_oxlint = cx.language().is_oxlint;
        // oxlint treats the fields and static blocks of a class nested in the constructor as part of the constructor.
        if is_oxlint
            && matches!(node, Node::Expr(_) | Node::Member(_))
            && let Some(code_path) = cx.state.constructor_of_derived_class()
        {
            cx.state.func_infos.push(FuncInfo { is_constructor_of_derived_class: true, code_path });
            return;
        }
        let super_class = match node {
            Node::Func(func) if cx.state.constructor == Some(func) => match func.owner() {
                Node::Member(member) if member.is_constructor() => match member.parent() {
                    Node::Class(class) => class.extends(),
                    _ => None,
                },
                _ => None,
            },
            _ => None,
        };
        cx.state.func_infos.push(FuncInfo {
            is_constructor_of_derived_class: super_class.is_some_and(|it| match is_oxlint {
                true => it.tag() != ExprTag::Null || it.is_parenthesized(),
                false => !ast_utils::is_null_or_undefined(it),
            }),
            code_path,
        });
    }

    fn on_code_path_end<'a>(&self, code_path: CodePath<'a>, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        if !cx.state.func_infos.pop().is_some_and(|it| it.is_constructor_of_derived_class && it.code_path == code_path) {
            return;
        }
        // ESLint's `onCodePathSegmentLoop` marks a loop's segment as called once `super()` is called in all of its
        // predecessors. That isn't needed here: the traversal below skips a segment when it skips all of its
        // predecessors, so such a segment is never visited, marked or not.
        //
        // In a `finally` block a node belongs to several segments.
        let mut reported = FxHashSet::default();
        // oxlint reports a constructor once, and points at it.
        let constructor = match node {
            Node::Func(func) if cx.language().is_oxlint => Some(func.span()),
            _ => None,
        };
        code_path.traverse_segments(|segment, controller| {
            let Some(info) = cx.state.seg_info_map.get(&segment.id()) else {
                return;
            };
            for invalid_node in &info.invalid_nodes {
                if reported.insert(*invalid_node) && (constructor.is_none() || reported.len() == 1) {
                    let kind = if invalid_node.tag() == ExprTag::Super { "super" } else { "this" };
                    cx.report(constructor.unwrap_or_else(|| invalid_node.span()), NO_BEFORE_SUPER).data("kind", kind);
                }
            }
            if info.super_called {
                controller.skip();
            }
        });
    }

    fn on_segment_start<'a>(&self, segment: Segment<'a>, _: Node<'a>, cx: &mut Cx<'a, Self>) {
        if cx.state.constructor_of_derived_class().is_none() {
            return;
        }
        let info = SegmentInfo {
            super_called: cx.state.is_called_before(segment),
            invalid_nodes: SmallVec::new(),
        };
        cx.state.seg_info_map.insert(segment.id(), info);
    }

    /// Called at each `this` and `super`.
    fn on_this_or_super<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        let Node::Expr(e) = node else {
            return;
        };
        let is_oxlint = cx.language().is_oxlint;
        if e.tag() == ExprTag::Super && ast_utils::is_callee(e) {
            // oxlint counts `super()` as called before its arguments run. If it finds a `this` in them, the call never
            // counts.
            let call = e.parent().as_expr().and_then(Expr::as_call).filter(|_| is_oxlint);
            if !call.is_some_and(|call| oxlint_contains_this_or_super(call.args())) {
                cx.state.enclosing_called_supers += u32::from(is_oxlint);
                return;
            }
        }
        if e.is_jsx_tag_name() && !is_oxlint || cx.state.enclosing_called_supers > 0 {
            return;
        }
        for segment in cx.state.segments_before_call_of_super().unwrap_or_default() {
            if let Some(info) = cx.state.seg_info_map.get_mut(&segment.id()) {
                info.invalid_nodes.push(e);
            }
        }
    }

    fn on_call_exit<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        let Node::Expr(e) = node else {
            return;
        };
        let Some(call) = e.as_call().filter(|call| call.callee().tag() == ExprTag::Super) else {
            return;
        };
        if cx.language().is_oxlint {
            if oxlint_contains_this_or_super(call.args()) {
                return;
            }
            cx.state.enclosing_called_supers = cx.state.enclosing_called_supers.saturating_sub(1);
        }
        Self::mark_as_called(cx);
    }

    fn mark_as_called(cx: &mut Cx<'_, Self>) {
        for segment in cx.state.segments_before_call_of_super().unwrap_or_default() {
            if let Some(info) = cx.state.seg_info_map.get_mut(&segment.id()) {
                info.super_called = true;
            }
        }
    }
}

impl Rule for NoThisBeforeSuper {
    const META: Meta = Meta::eslint("no-this-before-super", Kind::Problem).recommended().reports_on_code_path_end();
    const ON: On = On::new().classes();
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        NoThisBeforeSuper
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<State<'a>> {
        Some(State::default())
    }

    fn class<'a>(&self, class: Class<'a>, cx: &mut Cx<'a, Self>) {
        if class.extends().is_none() {
            return;
        }
        let constructors = class.members().iter().filter(|it| it.is_constructor());
        for constructor in constructors.filter_map(Member::func).filter(|it| it.has_body()) {
            if !calls_super_first(constructor) || Self::has_switch_with_early_default(constructor, cx) {
                self.check_constructor(constructor, cx);
            }
        }
    }
}

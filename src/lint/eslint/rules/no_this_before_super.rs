use super::constructor_super::first_super_statement;
use bun_lint::code_path::{Event, Step};
use bun_lint::prelude::*;
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
    /// It is the constructor of a class that has a valid `extends`.
    is_constructor_of_derived_class: bool,
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
    /// `winding_switches`
    winding_switches: Option<Vec<u32>>,
}

impl<'a> State<'a> {
    /// ESLint's `isInConstructorOfDerivedClass`: the innermost code path, if it is one to check.
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

    /// ESLint's `isBeforeCallOfSuper`: the current segments that are reachable, if `super()` is not
    /// called yet in all of the current segments of a constructor to check.
    fn segments_before_call_of_super(&self) -> Option<SmallVec<[Segment<'a>; 2]>> {
        let mut segments = self.constructor_of_derived_class()?.current_segments();
        if segments.iter().all(|it| self.is_called(*it)) {
            return None;
        }
        segments.retain(|it| it.is_reachable());
        Some(segments)
    }
}

/// Whether there is a `this` or a `super` in `node`.
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

/// Whether it can be told from the statements of the body alone that there is no `this` or `super`
/// before `super()` is called: that is a statement of its own there, and there is none in the
/// parameters, in the types of the signature, in what precedes it and in its arguments.
fn calls_super_first(constructor: Func<'_>) -> bool {
    first_super_statement(constructor).is_some_and(|(mut before, call)| {
        !constructor.params().iter().any(|it| has_this_or_super(it.into()))
            && !constructor.type_params().iter().any(|it| has_this_or_super(it.into()))
            && !constructor.return_type().is_some_and(|it| has_this_or_super(it.into()))
            && !before.any(|it| has_this_or_super(it.into()))
            && !call.args().iter().any(|it| has_this_or_super(it.into()))
    })
}

/// Where the `switch` statements start whose `default` is not the last case, sorted. Where such a statement is not
/// reached, ESLint has a segment that is reached and that nothing precedes, so `super()` is not called before it.
fn winding_switches<'a>(file: &'a File<'a>) -> Vec<u32> {
    let is_winding = |statement: &Stmt| match statement.kind() {
        StmtKind::Switch { cases, .. } => {
            cases.iter().position(|it| it.test().is_none()).is_some_and(|at| at + 1 < cases.len())
        }
        _ => false,
    };
    let winding = file.stmts_of_kind(StmtTag::Switch).filter(is_winding);
    let mut starts: Vec<u32> = winding.map(|it| it.span().start).collect();
    starts.sort_unstable();
    starts
}

impl NoThisBeforeSuper {
    fn has_winding_switch<'a>(constructor: Func<'a>, cx: &mut Cx<'a, Self>) -> bool {
        let file = cx.file();
        if !file.has_stmts([StmtTag::Switch]) {
            return false;
        }
        let starts = cx.state.winding_switches.get_or_insert_with(|| winding_switches(file));
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
    }

    fn on_code_path_start<'a>(&self, code_path: CodePath<'a>, node: Node<'a>, cx: &mut Cx<'a, Self>) {
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
            is_constructor_of_derived_class: super_class.is_some_and(|it| !ast_utils::is_null_or_undefined(it)),
            code_path,
        });
    }

    fn on_code_path_end<'a>(&self, code_path: CodePath<'a>, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        if !cx.state.func_infos.pop().is_some_and(|it| it.is_constructor_of_derived_class) {
            return;
        }
        // ESLint's `onCodePathSegmentLoop` marks the segments of a loop before all of which `super()` is
        // called. There is no need to: this leaves out a segment if it leaves out all that precede
        // it, so one that is marked for what precedes it is not looked at, marked or not.
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

    /// At a `this` or a `super`.
    fn on_this_or_super<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        let Node::Expr(e) = node else {
            return;
        };
        if e.tag() == ExprTag::Super && ast_utils::is_callee(e) || e.is_jsx_tag_name() {
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
        if !e.as_call().is_some_and(|call| call.callee().tag() == ExprTag::Super) {
            return;
        }
        for segment in cx.state.segments_before_call_of_super().unwrap_or_default() {
            if let Some(info) = cx.state.seg_info_map.get_mut(&segment.id()) {
                info.super_called = true;
            }
        }
    }
}

impl Rule for NoThisBeforeSuper {
    const META: Meta = Meta::eslint("no-this-before-super", Kind::Problem).recommended();
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        NoThisBeforeSuper
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> State<'a> {
        on.classes(|rule, class, cx| {
            if class.extends().is_none() {
                return;
            }
            let constructors = class.members().iter().filter(|it| it.is_constructor());
            for constructor in constructors.filter_map(Member::func).filter(|it| it.has_body()) {
                if !calls_super_first(constructor) || Self::has_winding_switch(constructor, cx) {
                    rule.check_constructor(constructor, cx);
                }
            }
        });
        State::default()
    }
}

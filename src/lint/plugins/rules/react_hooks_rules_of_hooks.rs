use crate::oxlint::{self, rules_of_hooks::Flow};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::FxHashMap;

/// Enforces the Rules of Hooks.
pub struct RulesOfHooks;

const TRY_CATCH: Message = Message::new("", "React Hook \"{{hook}}\" cannot be called in a try/catch block.");
const LOOP: Message = Message::new(
    "",
    "React Hook \"{{hook}}\" may be executed more than once. Possibly because it is called in a loop. React Hooks must be called in the exact same order in every component render.",
);
const ASYNC: Message = Message::new("", "React Hook \"{{hook}}\" cannot be called in an async function.");
const CONDITIONAL: Message = Message::new(
    "",
    "React Hook \"{{hook}}\" is called conditionally. React Hooks must be called in the exact same order in every component render.{{hint}}",
);
const CLASS: Message = Message::new(
    "",
    "React Hook \"{{hook}}\" cannot be called in a class component. React Hooks must be called in a React function component or a custom React Hook function.",
);
const FUNCTION: Message = Message::new(
    "",
    "React Hook \"{{hook}}\" is called in function \"{{function}}\" that is neither a React function component nor a custom React Hook function. React component names must start with an uppercase letter. React Hook names must start with the word \"use\".",
);
const TOP_LEVEL: Message = Message::new(
    "",
    "React Hook \"{{hook}}\" cannot be called at the top level. React Hooks must be called in a React function component or a custom React Hook function.",
);
const CALLBACK: Message = Message::new(
    "",
    "React Hook \"{{hook}}\" cannot be called inside a callback. React Hooks must be called in a React function component or a custom React Hook function.",
);
const EFFECT_EVENT_PASSED_DOWN: Message = Message::new(
    "",
    "React Hook \"useEffectEvent\" can only be called at the top level of your component. It cannot be passed down.",
);
const EFFECT_EVENT_FUNCTION: Message = Message::new(
    "",
    "`{{function}}` is a function created with React Hook \"useEffectEvent\", and can only be called from Effects and Effect Events in the same component.{{hint}}",
);

/// `use`, or `use` and then an uppercase Latin letter or a digit, which leaves out `user`.
pub(crate) fn is_hook_name(name: &[u8]) -> bool {
    match name.strip_prefix(b"use") {
        Some([]) => true,
        Some([next, ..]) => next.is_ascii_uppercase() || next.is_ascii_digit(),
        None => false,
    }
}

fn starts_with_uppercase(name: Name) -> bool {
    name.bytes().first().is_some_and(u8::is_ascii_uppercase)
}

/// `useState`, `React.useState`: the name of a hook, which can be a member of what is named in Pascal case.
fn is_hook(e: Expr) -> bool {
    match e.kind() {
        ExprKind::Ident(name) => is_hook_name(name.bytes()),
        ExprKind::Dot { obj, name, .. } => is_hook_name(name.bytes()) && obj.as_ident().is_some_and(starts_with_uppercase),
        _ => false,
    }
}

/// `name`, `React.name`
fn is_react_function(e: Expr, function: &str) -> bool {
    match e.kind() {
        ExprKind::Ident(name) => name.is(function),
        ExprKind::Dot { obj, name, .. } => obj.is_ident("React") && name.name().is(function),
        ExprKind::Index { obj, index, .. } => obj.is_ident("React") && index.is_ident(function),
        _ => false,
    }
}

/// `isForwardRefCallback(node) || isMemoCallback(node)`
fn is_forward_ref_or_memo_callback(e: Expr) -> bool {
    match e.parent() {
        Node::Expr(parent) if !e.is_chain_root() => match parent.kind() {
            ExprKind::Call(call) | ExprKind::New(call) => {
                is_react_function(call.callee(), "forwardRef") || is_react_function(call.callee(), "memo")
            }
            _ => false,
        },
        _ => false,
    }
}

/// What `getFunctionName` returns.
#[derive(Copy, Clone)]
enum FunctionName<'a> {
    Ident(Name<'a>, Span),
    Expr(Expr<'a>),
    /// A pattern, or a key that is a string or a number.
    Other(Span),
}

impl<'a> FunctionName<'a> {
    fn of_pattern(pat: Pat<'a>, span: Span) -> FunctionName<'a> {
        match pat.as_ident() {
            Some(name) => FunctionName::Ident(name, span),
            None => FunctionName::Other(span),
        }
    }

    fn span(self) -> Span {
        match self {
            FunctionName::Ident(_, span) | FunctionName::Other(span) => span,
            FunctionName::Expr(e) => e.span(),
        }
    }

    /// `isComponentName(name) || isHook(name)`
    fn is_component_or_hook(self) -> bool {
        match self {
            FunctionName::Ident(name, _) => starts_with_uppercase(name) || is_hook_name(name.bytes()),
            FunctionName::Expr(e) => match e.kind() {
                ExprKind::Ident(name) => starts_with_uppercase(name) || is_hook_name(name.bytes()),
                _ => is_hook(e),
            },
            FunctionName::Other(_) => false,
        }
    }
}

/// The name that JavaScript gives the function, roughly.
fn get_function_name(func: Func) -> Option<FunctionName> {
    if let Some(name) = func.name()
        && matches!(func.kind(), FnKind::Decl | FnKind::Expr)
    {
        return Some(FunctionName::Ident(name.name(), name.span()));
    }
    let Node::Expr(e) = func.owner() else {
        return None;
    };
    match e.parent() {
        Node::VarDecl(declarator) => Some(FunctionName::of_pattern(declarator.pat(), declarator.binding_span())),
        Node::Expr(parent) => match parent.kind() {
            ExprKind::Assign {
                op: None,
                target,
                value,
            } if value == e => Some(FunctionName::Expr(target)),
            _ => None,
        },
        Node::Prop(prop) if !prop.is_jsx_attribute() && prop.value() == Some(e) => {
            let key = prop.key()?;
            match key.kind() {
                KeyKind::Ident(name) => Some(FunctionName::Ident(name, key.span(e.file()))),
                KeyKind::String(_) | KeyKind::Number(_) => Some(FunctionName::Other(key.span(e.file()))),
                _ => None,
            }
        }
        Node::Param(param) => Some(FunctionName::of_pattern(param.pat(), param.binding_span())),
        Node::PatElem(element) => element.pat().map(|pat| FunctionName::of_pattern(pat, pat.span())),
        Node::PatProp(prop) if prop.default() == Some(e) => Some(FunctionName::of_pattern(prop.value(), prop.value().span())),
        _ => None,
    }
}

fn is_inside_component_or_hook(node: Node) -> bool {
    std::iter::once(node).chain(node.ancestors()).any(|it| match it {
        Node::Func(func) => get_function_name(func).is_some_and(FunctionName::is_component_or_hook),
        Node::Expr(e) => is_forward_ref_or_memo_callback(e),
        _ => false,
    })
}

fn is_inside_do_while_loop(e: Expr) -> bool {
    Node::Expr(e).ancestors().any(|it| matches!(it, Node::Stmt(stmt) if stmt.tag() == StmtTag::DoWhile))
}

fn is_inside_try_catch(e: Expr) -> bool {
    Node::Expr(e).ancestors().any(|it| matches!(it, Node::Stmt(stmt) if stmt.tag() == StmtTag::Try))
}

/// The `useEffect` of `React.useEffect`.
fn name_without_react_namespace(callee: Expr) -> Option<Name> {
    match callee.kind() {
        ExprKind::Ident(name) => Some(name),
        ExprKind::Dot { obj, name, .. } if obj.is_ident("React") && !name.bytes().starts_with(b"#") => Some(name.name()),
        _ => None,
    }
}

/// The number of routes through a part of a code path, which doubles with every `if`. It is only compared, with 0 and with another:
/// so it is kept modulo a prime.
#[derive(Copy, Clone, PartialEq, Eq)]
struct Count {
    residue: u64,
    is_zero: bool,
}

impl Count {
    const MODULUS: u64 = (1 << 61) - 1;
    const ZERO: Count = Count {
        residue: 0,
        is_zero: true,
    };
    const ONE: Count = Count {
        residue: 1,
        is_zero: false,
    };

    fn plus(self, other: Count) -> Count {
        Count {
            residue: (self.residue + other.residue) % Count::MODULUS,
            is_zero: self.is_zero && other.is_zero,
        }
    }

    fn times(self, other: Count) -> Count {
        Count {
            residue: (u128::from(self.residue) * u128::from(other.residue) % u128::from(Count::MODULUS)) as u64,
            is_zero: self.is_zero || other.is_zero,
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Direction {
    FromStart,
    ToEnd,
}

/// What is computed about the segments of one code path that has calls of hooks.
struct Paths<'a> {
    thrown: Segments<'a>,
    /// The ids of the segments that are in a cycle.
    cyclic: Vec<u32>,
    from_start: FxHashMap<u32, Count>,
    to_end: FxHashMap<u32, Count>,
    /// `None` while it is computed.
    shortest: FxHashMap<u32, Option<u32>>,
    /// A call that cannot be reached is counted for the segment of the code path around that the function is in. Upstream looks at
    /// that while it is analyzed, when it leads nowhere yet and nothing made later leads to it.
    outer: Option<Segment<'a>>,
}

type Segments<'a> = bun_lint::code_path::Segments<'a>;

const INFINITY: u32 = u32::MAX;

impl<'a> Paths<'a> {
    fn neighbors(&self, segment: Segment<'a>, direction: Direction) -> Segments<'a> {
        let Some(outer) = self.outer.filter(|outer| outer.code_path() == segment.code_path()) else {
            return match direction {
                Direction::FromStart => segment.prev_segments(),
                Direction::ToEnd => segment.next_segments(),
            };
        };
        let mut all = match direction {
            Direction::FromStart => segment.prev_segments(),
            Direction::ToEnd => segment.next_segments(),
        };
        all.retain(|it| it.id() <= outer.id() && (direction == Direction::FromStart || segment != outer));
        all
    }

    /// `countPathsFromStart` and `countPathsToEnd`, which also find the segments that are in a cycle.
    fn count(&mut self, start: Segment<'a>, direction: Direction) -> Count {
        struct Frame<'a> {
            segment: Segment<'a>,
            neighbors: Segments<'a>,
            next: usize,
            sum: Count,
        }
        let mut stack: Vec<Frame<'a>> = Vec::new();
        let mut entering = Some(start);
        let mut returned = Count::ZERO;
        loop {
            if let Some(segment) = entering.take() {
                let cache = match direction {
                    Direction::FromStart => &self.from_start,
                    Direction::ToEnd => &self.to_end,
                };
                if let Some(at) = stack.iter().position(|it| it.segment == segment) {
                    self.cyclic.extend(stack[at + 1..].iter().map(|it| it.segment.id()));
                    returned = Count::ZERO;
                } else if let Some(&cached) = cache.get(&segment.id()) {
                    returned = cached;
                } else {
                    let is_thrown = self.thrown.contains(&segment);
                    let neighbors = if is_thrown { Segments::new() } else { self.neighbors(segment, direction) };
                    stack.push(Frame {
                        segment,
                        sum: if is_thrown || !neighbors.is_empty() { Count::ZERO } else { Count::ONE },
                        neighbors,
                        next: 0,
                    });
                    returned = Count::ZERO;
                }
            }
            let Some(top) = stack.last_mut() else {
                return returned;
            };
            top.sum = top.sum.plus(returned);
            returned = Count::ZERO;
            if let Some(&neighbor) = top.neighbors.get(top.next) {
                top.next += 1;
                entering = Some(neighbor);
                continue;
            }
            let (segment, sum) = (top.segment, top.sum);
            stack.pop();
            match direction {
                // There is a route from the start to a segment that can be reached: it was asked from inside a cycle.
                Direction::FromStart if segment.is_reachable() && sum.is_zero => {
                    self.from_start.remove(&segment.id());
                }
                Direction::FromStart => {
                    self.from_start.insert(segment.id(), sum);
                }
                Direction::ToEnd => {
                    self.to_end.insert(segment.id(), sum);
                }
            }
            if stack.is_empty() {
                return sum;
            }
            returned = sum;
        }
    }

    /// `shortestPathLengthToStart`
    fn shortest_path_length_to_start(&mut self, start: Segment<'a>) -> u32 {
        struct Frame<'a> {
            segment: Segment<'a>,
            prev: Segments<'a>,
            next: usize,
            length: u32,
        }
        let mut stack: Vec<Frame<'a>> = Vec::new();
        let mut entering = Some(start);
        let mut returned = INFINITY;
        loop {
            if let Some(segment) = entering.take() {
                match self.shortest.get(&segment.id()) {
                    Some(None) => returned = INFINITY,
                    Some(&Some(length)) => returned = length,
                    None => {
                        self.shortest.insert(segment.id(), None);
                        stack.push(Frame {
                            segment,
                            prev: self.neighbors(segment, Direction::FromStart),
                            next: 0,
                            length: INFINITY,
                        });
                        returned = INFINITY;
                    }
                }
            }
            let Some(top) = stack.last_mut() else {
                return returned;
            };
            top.length = top.length.min(returned);
            returned = INFINITY;
            if let Some(&prev) = top.prev.get(top.next) {
                top.next += 1;
                entering = Some(prev);
                continue;
            }
            let length = if top.prev.is_empty() { 1 } else { top.length.saturating_add(1) };
            self.shortest.insert(top.segment.id(), Some(length));
            stack.pop();
            if stack.is_empty() {
                return length;
            }
            returned = length;
        }
    }
}

#[derive(Default)]
pub struct State<'a> {
    /// The segments that have started and not ended, of all code paths. Only those that can be reached.
    segments: Vec<Segment<'a>>,
    /// The callees that are hooks, with the segment that each is in, of the code paths that have not ended.
    hooks: Vec<(Option<Segment<'a>>, Expr<'a>)>,
    /// Where those of each code path start in `hooks`.
    starts: Vec<usize>,
}

impl Rule for RulesOfHooks {
    const META: Meta = Meta::plugin(Plugin::ReactHooks, "rules-of-hooks", Kind::Problem).recommended();
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        RulesOfHooks
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> State<'a> {
        let (mut has_hooks, mut has_effect_events) = (false, false);
        for e in file.exprs_of_kind(ExprTag::Call) {
            if let ExprKind::Call(call) = e.kind() {
                has_hooks |= is_hook(call.callee());
                has_effect_events |= name_without_react_namespace(call.callee()).is_some_and(|it| it.is("useEffectEvent"));
            }
        }
        if has_hooks {
            on.segment_start(|_, segment, _, cx| cx.state.segments.push(segment));
            on.segment_end(|_, _, _, cx| {
                cx.state.segments.pop();
            });
            on.code_path_start(|_, _, _, cx| cx.state.starts.push(cx.state.hooks.len()));
            on.code_path_end(Self::code_path_end);
            on.enter(ExprTag::Call, |_, node, cx| {
                if let Node::Expr(e) = node
                    && let ExprKind::Call(call) = e.kind()
                    && is_hook(call.callee())
                {
                    let segment = cx.state.segments.last().copied();
                    cx.state.hooks.push((segment, call.callee()));
                }
            });
        }
        if has_effect_events && !oxlint::is_followed(file) {
            on.finish(Self::check_effect_events);
        }
        State::default()
    }
}

/// A comment `$FlowFixMe[react-rule-hook]` ends on the line before.
fn has_flow_suppression<'a>(file: &'a File<'a>, hook: Expr<'a>) -> bool {
    const SUPPRESSION: &[u8] = b"$FlowFixMe[react-rule-hook]";
    strings::contains(file.text(), SUPPRESSION) && {
        let line = file.line_of(hook.span().start);
        file.comments().any(|comment| strings::contains(comment.value(), SUPPRESSION) && file.line_of(comment.end()) + 1 == line)
    }
}

impl RulesOfHooks {
    fn code_path_end<'a>(&self, code_path: CodePath<'a>, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        let start = cx.state.starts.pop().unwrap_or(0);
        if cx.state.hooks.len() <= start {
            return;
        }
        let hooks = cx.state.hooks.split_off(start);
        let mut paths = Paths {
            thrown: code_path.thrown_segments(),
            cyclic: Vec::new(),
            from_start: FxHashMap::default(),
            to_end: FxHashMap::default(),
            shortest: FxHashMap::default(),
            outer: hooks.iter().find_map(|it| it.0.filter(|segment| segment.code_path() != code_path)),
        };
        let all_paths_from_start_to_end = paths.count(code_path.initial_segment(), Direction::ToEnd);

        let func = node.as_func();
        let function_name = func.and_then(get_function_name);
        let is_somewhere_inside_component_or_hook = is_inside_component_or_hook(node);
        let function_expr = match (node, func.map(Func::owner)) {
            (Node::Expr(e), _) | (_, Some(Node::Expr(e))) => Some(e),
            _ => None,
        };
        let is_directly_inside_component_or_hook = match function_name {
            Some(name) => name.is_component_or_hook(),
            None => function_expr.is_some_and(is_forward_ref_or_memo_callback),
        };
        // It is the value of a method or of a property of a class.
        let is_in_class = match (func.map(Func::owner), function_expr.map(Expr::parent)) {
            (Some(Node::Member(member)), _) => member.kind() != MemberKind::StaticBlock,
            (_, Some(Node::Member(member))) => member.init() == function_expr && !member.flags().contains(Flags::ACCESSOR),
            _ => false,
        };

        let mut shortest_final_path_length = INFINITY;
        for segment in code_path.final_segments() {
            if segment.is_reachable() {
                shortest_final_path_length = shortest_final_path_length.min(paths.shortest_path_length_to_start(segment));
            }
        }

        let follows_oxlint = oxlint::is_followed(cx.file());
        for &(segment, hook) in &hooks {
            let Some(segment) = segment.filter(|it| it.is_reachable()) else {
                if follows_oxlint && let Node::Expr(call) = hook.parent() {
                    let flow = Flow {
                        is_reachable: false,
                        is_cyclic: false,
                        is_conditional: false,
                    };
                    oxlint::rules_of_hooks::check(cx, call, flow);
                }
                continue;
            };
            let length = paths.shortest_path_length_to_start(segment);
            let possibly_has_early_return = match paths.neighbors(segment, Direction::ToEnd).is_empty() {
                true => shortest_final_path_length <= length,
                false => shortest_final_path_length < length,
            };
            let paths_from_start_to_end =
                paths.count(segment, Direction::FromStart).times(paths.count(segment, Direction::ToEnd));
            let is_cycled = paths.cyclic.contains(&segment.id());
            if follows_oxlint {
                if let Node::Expr(call) = hook.parent() {
                    let flow = Flow {
                        is_reachable: true,
                        is_cyclic: is_cycled,
                        is_conditional: paths_from_start_to_end != all_paths_from_start_to_end,
                    };
                    oxlint::rules_of_hooks::check(cx, call, flow);
                }
                continue;
            }
            let is_use = is_react_function(hook, "use");
            let report = |message: Message| cx.report(hook, message).data("hook", hook.text());
            let mut reports: smallvec::SmallVec<[Message; 2]> = smallvec::SmallVec::new();

            if is_use && is_inside_try_catch(hook) {
                reports.push(TRY_CATCH);
            }
            if !is_use && (is_cycled || is_inside_do_while_loop(hook)) {
                reports.push(LOOP);
            }
            if is_directly_inside_component_or_hook {
                if func.is_some_and(Func::is_async) {
                    reports.push(ASYNC);
                }
                if !is_cycled
                    && paths_from_start_to_end != all_paths_from_start_to_end
                    && !is_use
                    && !is_inside_do_while_loop(hook)
                {
                    reports.push(CONDITIONAL);
                }
            } else if is_in_class {
                reports.push(CLASS);
            } else if function_name.is_some() {
                reports.push(FUNCTION);
            } else if matches!(node, Node::File(_)) {
                reports.push(TOP_LEVEL);
            } else if is_somewhere_inside_component_or_hook && !is_use {
                reports.push(CALLBACK);
            }
            if reports.is_empty() || has_flow_suppression(cx.file(), hook) {
                continue;
            }
            for message in reports {
                let hint = match possibly_has_early_return {
                    true => " Did you accidentally call a React Hook after an early return?",
                    false => "",
                };
                report(message).data("hint", hint).data("function", function_name.map_or(&b""[..], |it| cx.slice(it.span())));
            }
        }
    }

    /// What is about `useEffectEvent`, which upstream does while it walks.
    fn check_effect_events<'a>(&self, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        let additional_effect_hooks = file
            .settings()
            .get(b"react-hooks")
            .and_then(|it| it.get(b"additionalEffectHooks")?.as_str())
            .and_then(|it| Regex::from_bytes(it, b"").ok());
        // The calls in which such a function can be referred to, in the order in which the walk enters them.
        let mut effects: Vec<Span> = Vec::new();
        let mut functions: Vec<Reference<'a>> = Vec::new();
        for e in file.exprs_of_kind(ExprTag::Call) {
            let ExprKind::Call(call) = e.kind() else {
                continue;
            };
            let Some(name) = name_without_react_namespace(call.callee()) else {
                continue;
            };
            let is_effect_event = name.is("useEffectEvent");
            let is_effect = name.is_any(&["useEffect", "useLayoutEffect", "useInsertionEffect"])
                || additional_effect_hooks.as_ref().is_some_and(|it| it.test(name.bytes()));
            if (is_effect || is_effect_event) && !call.args().is_empty() {
                effects.push(e.span());
            }
            if !is_effect_event {
                continue;
            }
            let parent = e.parent();
            let is_expression_statement = matches!(parent, Node::Stmt(stmt) if stmt.tag() == StmtTag::Expr && !stmt.is_wrapper());
            if e.is_chain_root() || !(matches!(parent, Node::VarDecl(_)) || is_expression_statement) {
                cx.report(e, EFFECT_EVENT_PASSED_DOWN);
            }
            // `recordAllUseEffectEventFunctions`
            if let Node::VarDecl(declarator) = parent
                && !e.is_chain_root()
                && call.callee().tag() == ExprTag::Ident
                && declarator.pat().tag() == PatTag::Ident
                && let Some(symbol) = declarator.pat().symbol()
                && let Some(declaring) = symbol.references().find(|it| it.span() == declarator.pat().span())
                && let Node::Func(func) = declaring.scope().node()
                && matches!(func.kind(), FnKind::Decl | FnKind::Arrow)
                && is_inside_component_or_hook(Node::Func(func))
            {
                functions.extend(symbol.references().filter(|it| *it != declaring));
            }
        }
        if functions.is_empty() {
            return;
        }
        effects.sort_unstable_by_key(|it| (it.start, std::cmp::Reverse(it.end)));
        functions.sort_unstable_by_key(|it| it.span().start);
        functions.dedup();
        for reference in functions {
            let Some(e) = reference.expr().filter(|it| !it.is_jsx_tag_name()) else {
                continue;
            };
            // The call that was entered last, if the walk has not left it.
            let entered = effects.partition_point(|it| it.start <= e.span().start);
            if entered.checked_sub(1).and_then(|at| effects.get(at)).is_some_and(|it| it.contains(e.span())) {
                continue;
            }
            let is_called = matches!(e.parent(), Node::Expr(parent) if parent.tag() == ExprTag::Call);
            let hint = if is_called { "" } else { " It cannot be assigned to a variable or passed down." };
            cx.report(e, EFFECT_EVENT_FUNCTION).data("function", e.text()).data("hint", hint);
        }
    }
}

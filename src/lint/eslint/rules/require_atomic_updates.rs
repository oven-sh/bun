use bun_lint::code_path::{Event, Step};
use bun_lint::prelude::*;
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

/// Disallow assignments that can lead to race conditions due to usage of `await` or `yield`.
pub struct RequireAtomicUpdates {
    allow_properties: bool,
}

const NON_ATOMIC_UPDATE: Message = Message::new(
    "nonAtomicUpdate",
    "Possible race condition: `{{value}}` might be reassigned based on an outdated value of `{{value}}`.",
);
const NON_ATOMIC_OBJECT_UPDATE: Message = Message::new(
    "nonAtomicObjectUpdate",
    "Possible race condition: `{{value}}` might be assigned based on an outdated state of `{{object}}`.",
);

/// ESLint's `Variable`.
#[derive(Copy, Clone, PartialEq, Eq, Hash)]
enum Variable<'a> {
    Declared(Symbol<'a>),
    /// A global variable of the configuration.
    Global(Name<'a>),
}

impl<'a> Variable<'a> {
    fn name(self) -> Name<'a> {
        match self {
            Variable::Declared(symbol) => symbol.name(),
            Variable::Global(name) => name,
        }
    }
}

/// A reference, what it refers to, and the number of that in the [`ReadSets`].
type Resolved<'a> = (Reference<'a>, Variable<'a>, u32);

/// By where the identifier starts.
type ReferenceMap<'a> = FxHashMap<u32, Resolved<'a>>;

/// The references in `scope`, which is that of a function, without those in nested functions.
fn create_reference_map<'a>(scope: Scope<'a>, file: &'a File<'a>, sets: &mut ReadSets<'a>) -> ReferenceMap<'a> {
    let mut map = ReferenceMap::default();
    let mut scopes: SmallVec<[Scope<'a>; 8]> = SmallVec::new();
    scopes.push(scope);
    while let Some(scope) = scopes.pop() {
        for reference in scope.references() {
            let variable = match reference.symbol() {
                Some(symbol) => Variable::Declared(symbol),
                None if ast_utils::is_configured_global(file, reference.name().bytes()) => {
                    Variable::Global(reference.name())
                }
                None => continue,
            };
            map.insert(reference.ident().start(), (reference, variable, sets.number_of(variable)));
        }
        scopes.extend(scope.children().filter(|it| it.kind() != ScopeKind::Function));
    }
    map
}

/// What is assigned. For the `a` of `a.b = c`, which is read, it is `c`.
fn get_write_expr<'a>(reference: Reference<'a>) -> Option<Expr<'a>> {
    if let Some(write_expr) = reference.write_expr() {
        return Some(write_expr);
    }
    let mut node = reference.expr()?;
    loop {
        let Node::Expr(parent) = node.parent() else {
            return None;
        };
        match parent.kind() {
            ExprKind::Assign { target, value, .. }
                if target == node && !utils::is_assignment_target(parent) =>
            {
                return Some(value);
            }
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. }
                if obj == node && !parent.is_chain_root() =>
            {
                node = parent;
            }
            _ => return None,
        }
    }
}

/// `writeExpr.parent.operator === "="`
fn is_right_of_plain_assignment(write_expr: Expr) -> bool {
    matches!(write_expr.parent(), Node::Expr(parent)
        if matches!(parent.kind(), ExprKind::Assign { op: None, value, .. } if value == write_expr))
}

/// The node of ESLint that an expression is the `right` of: an `AssignmentExpression`, an
/// `AssignmentPattern`, a `ForInStatement` or a `ForOfStatement`.
struct Assignment {
    span: Span,
    left: Span,
    is_left_identifier: bool,
}

fn assignment_of<'a>(right: Expr<'a>) -> Option<Assignment> {
    let with_default = |pat: Pat<'a>| Assignment {
        span: Span::new(pat.span().start, right.outer_span().end),
        left: utils::estree_span(Node::Pat(pat)),
        is_left_identifier: pat.tag() == PatTag::Ident,
    };
    match right.parent() {
        Node::Expr(parent) => match parent.kind() {
            ExprKind::Assign { target, value, .. } if value == right => Some(Assignment {
                span: parent.span(),
                left: target.span(),
                is_left_identifier: target.tag() == ExprTag::Ident,
            }),
            _ => None,
        },
        Node::Param(param) if param.default() == Some(right) => Some(with_default(param.pat())),
        Node::PatProp(property) if property.default() == Some(right) => Some(with_default(property.value())),
        Node::PatElem(element) => element.pat().map(with_default),
        Node::Stmt(statement) => match statement.kind() {
            StmtKind::ForIn { left, expr, .. } | StmtKind::ForOf { left, expr, .. } if expr == right => {
                let (left, is_left_identifier) = match left.kind() {
                    StmtKind::Expr(target) => (target.span(), target.tag() == ExprTag::Ident),
                    _ => (left.span(), false),
                };
                Some(Assignment {
                    span: statement.span(),
                    left,
                    is_left_identifier,
                })
            }
            _ => None,
        },
        _ => None,
    }
}

/// Whether the variable can only be observed within the function that declares it.
fn is_local_variable_without_escape(symbol: Symbol, is_member_access: bool) -> bool {
    if is_member_access && symbol.declarations().any(|def| matches!(def, Declaration::Param(_))) {
        return false;
    }
    let function_scope = symbol.scope().variable_scope();
    symbol.references().all(|reference| reference.scope().variable_scope() == function_scope)
}

/// ESLint's `freshReadVariables` and `outdatedReadVariables` of a segment: two bits for each
/// variable. With `height` 0, `root` has the bits of the first 16 variables. Otherwise it is a node
/// of [`ReadSets`] with two halves of `height - 1`, and 0 if no bit is set.
#[derive(Copy, Clone, Default)]
struct SegmentInfo {
    root: u32,
    height: u8,
}

const VARIABLES_PER_BLOCK: u32 = 16;
const FRESH: u32 = 0x5555_5555;
const OUTDATED: u32 = FRESH << 1;
const UNKNOWN: u32 = u32::MAX;

/// The nodes of all [`SegmentInfo`]s. A segment starts with what the segments before it end with,
/// and changes little of it. So equal halves are one node, which makes what has not changed cost
/// nothing: neither memory, nor time where two of them are joined. What has been computed of a node
/// is remembered.
#[derive(Default)]
struct ReadSets<'a> {
    numbers: FxHashMap<Variable<'a>, u32>,
    /// The halves of each node. The first is not used.
    nodes: Vec<[u32; 2]>,
    /// By height and halves.
    interned: FxHashMap<(u8, [u32; 2]), u32>,
    /// By node: the result of `make_outdated`, or `UNKNOWN`.
    outdated: Vec<u32>,
    /// By two nodes, the lower first.
    unions: FxHashMap<[u32; 2], u32>,
}

impl<'a> ReadSets<'a> {
    fn clear(&mut self) {
        self.numbers.clear();
        self.nodes.clear();
        self.interned.clear();
        self.outdated.clear();
        self.unions.clear();
    }

    fn number_of(&mut self, variable: Variable<'a>) -> u32 {
        let next = self.numbers.len() as u32;
        *self.numbers.entry(variable).or_insert(next)
    }

    fn halves(&self, node: u32) -> [u32; 2] {
        self.nodes.get(node as usize).copied().unwrap_or_default()
    }

    fn node(&mut self, height: u8, halves: [u32; 2]) -> u32 {
        if halves == [0, 0] {
            return 0;
        }
        if self.nodes.is_empty() {
            self.nodes.push([0, 0]);
            self.outdated.push(0);
        }
        let next = self.nodes.len() as u32;
        let node = *self.interned.entry((height, halves)).or_insert(next);
        if node == next {
            self.nodes.push(halves);
            self.outdated.push(UNKNOWN);
        }
        node
    }

    /// The root of `info` at a `height` that is not lower than its own.
    fn root_at(&mut self, info: SegmentInfo, height: u8) -> u32 {
        (info.height..height).fold(info.root, |root, below| self.node(below + 1, [root, 0]))
    }

    /// Which half of a node of `height` has the variable.
    fn half_of(variable: u32, height: u8) -> usize {
        (((variable / VARIABLES_PER_BLOCK) >> (height - 1)) & 1) as usize
    }

    fn mark_in(&mut self, root: u32, height: u8, variable: u32) -> u32 {
        if height == 0 {
            let shift = (variable % VARIABLES_PER_BLOCK) * 2;
            return (root & !(0b11 << shift)) | (0b01 << shift);
        }
        let mut halves = self.halves(root);
        let half = &mut halves[Self::half_of(variable, height)];
        *half = self.mark_in(*half, height - 1, variable);
        self.node(height, halves)
    }

    /// ESLint's `markAsRead`: it is fresh, and no longer outdated.
    fn mark_as_read(&mut self, info: SegmentInfo, variable: u32) -> SegmentInfo {
        let blocks = variable / VARIABLES_PER_BLOCK;
        let height = info.height.max((u32::BITS - blocks.leading_zeros()) as u8);
        let root = self.root_at(info, height);
        SegmentInfo {
            root: self.mark_in(root, height, variable),
            height,
        }
    }

    fn make_outdated_in(&mut self, root: u32, height: u8) -> u32 {
        if height == 0 {
            return ((root & FRESH) << 1) | (root & OUTDATED);
        }
        match self.outdated.get(root as usize) {
            Some(&UNKNOWN) => {}
            known => return known.copied().unwrap_or(0),
        }
        let halves = self.halves(root).map(|half| self.make_outdated_in(half, height - 1));
        let result = self.node(height, halves);
        if let Some(known) = self.outdated.get_mut(root as usize) {
            *known = result;
        }
        result
    }

    /// ESLint's `makeOutdated`: what is fresh is outdated.
    fn make_outdated(&mut self, info: SegmentInfo) -> SegmentInfo {
        SegmentInfo {
            root: self.make_outdated_in(info.root, info.height),
            height: info.height,
        }
    }

    fn union_in(&mut self, a: u32, b: u32, height: u8) -> u32 {
        if a == b || b == 0 {
            return a;
        }
        if a == 0 {
            return b;
        }
        if height == 0 {
            return a | b;
        }
        let key = [a.min(b), a.max(b)];
        if let Some(&known) = self.unions.get(&key) {
            return known;
        }
        let ([a0, a1], [b0, b1]) = (self.halves(a), self.halves(b));
        let halves = [self.union_in(a0, b0, height - 1), self.union_in(a1, b1, height - 1)];
        let result = self.node(height, halves);
        self.unions.insert(key, result);
        result
    }

    fn union(&mut self, a: SegmentInfo, b: SegmentInfo) -> SegmentInfo {
        let height = a.height.max(b.height);
        let (a, b) = (self.root_at(a, height), self.root_at(b, height));
        SegmentInfo {
            root: self.union_in(a, b, height),
            height,
        }
    }

    /// ESLint's `isOutdated`
    fn is_outdated(&self, info: SegmentInfo, variable: u32) -> bool {
        if (u64::from(variable / VARIABLES_PER_BLOCK) >> info.height) != 0 {
            return false;
        }
        let block = (1..=info.height).rev().fold(info.root, |root, height| {
            self.halves(root)[Self::half_of(variable, height)]
        });
        (block >> ((variable % VARIABLES_PER_BLOCK) * 2)) & 0b10 != 0
    }
}

struct Frame<'a> {
    code_path: CodePath<'a>,
    /// Of an async function or a generator.
    reference_map: Option<ReferenceMap<'a>>,
}

#[derive(Default)]
pub struct State<'a> {
    stack: Vec<Frame<'a>>,
    /// By `Segment::id`, for the reachable segments of async functions and generators.
    segment_info: FxHashMap<u32, SegmentInfo>,
    read_sets: ReadSets<'a>,
    /// The current segments where the `ChainExpression` that is being left is left.
    segments_after_chain: Option<SmallVec<[Segment<'a>; 2]>>,
    /// By what is assigned: the references to verify once that has been evaluated.
    assignment_references: FxHashMap<Expr<'a>, SmallVec<[Resolved<'a>; 1]>>,
    /// [`is_local_variable_without_escape`] of the variables that are referred to many times.
    local_variables: FxHashMap<(Symbol<'a>, bool), bool>,
    /// Where the `await` and the `yield` expressions of the file start, in ascending order.
    pauses: Option<Vec<u32>>,
}

impl<'a> State<'a> {
    /// Each assignment to the variable asks.
    fn is_local_variable_without_escape(&mut self, variable: Variable<'a>, is_member_access: bool) -> bool {
        // It is referred to from a function, which is not where it is declared.
        let Variable::Declared(symbol) = variable else {
            return false;
        };
        if symbol.references().len() <= 8 {
            return is_local_variable_without_escape(symbol, is_member_access);
        }
        *(self.local_variables.entry((symbol, is_member_access)))
            .or_insert_with(|| is_local_variable_without_escape(symbol, is_member_access))
    }

    fn has_pause_in(&mut self, file: &'a File<'a>, span: Span) -> bool {
        let pauses = self.pauses.get_or_insert_with(|| {
            let pauses = file.exprs_of_kind(ExprTag::Await).chain(file.exprs_of_kind(ExprTag::Yield));
            let mut starts: Vec<u32> = pauses.map(|it| it.span().start).collect();
            starts.sort_unstable();
            starts
        });
        let first = pauses.get(pauses.partition_point(|&start| start < span.start));
        first.is_some_and(|&start| start < span.end)
    }
}

/// What `:expression` matches.
const EXPRESSIONS: [ExprTag; 33] = [
    ExprTag::Ident,
    ExprTag::This,
    ExprTag::Null,
    ExprTag::True,
    ExprTag::False,
    ExprTag::Number,
    ExprTag::String,
    ExprTag::BigInt,
    ExprTag::Regex,
    ExprTag::Template,
    ExprTag::TaggedTemplate,
    ExprTag::Array,
    ExprTag::Object,
    ExprTag::Fn,
    ExprTag::Class,
    ExprTag::Dot,
    ExprTag::Index,
    ExprTag::Call,
    ExprTag::New,
    ExprTag::Unary,
    ExprTag::Binary,
    ExprTag::Assign,
    ExprTag::Cond,
    ExprTag::Await,
    ExprTag::Yield,
    ExprTag::As,
    ExprTag::Satisfies,
    ExprTag::AsConst,
    ExprTag::NonNull,
    ExprTag::Instantiation,
    ExprTag::ImportCall,
    ExprTag::ImportMeta,
    ExprTag::NewTarget,
];

impl RequireAtomicUpdates {
    /// Checks an async function or a generator, with the functions in it: what is assigned can be
    /// one of them, and is then looked at where it ends.
    fn check_function<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        if !cx.state.has_pause_in(cx.file(), func.span()) {
            return;
        }
        // By the scopes, of which there are fewer around it than nodes.
        let is_in_another = func.scope().is_some_and(|scope| {
            scope.chain().any(|it| match it.node() {
                Node::Func(outer) => outer != func && (outer.is_async() || outer.is_generator()),
                _ => false,
            })
        });
        if is_in_another {
            return;
        }
        // ESLint leaves the `ChainExpression` around an optional chain where the ways through it have
        // joined, which is after its outermost expression has been left. That the last of the
        // events for that has been seen is only known when the segments have changed again.
        let mut chain = None;
        for step in func.code_path_steps(NodeTags::PAT | ExprTag::Ident.into(), EXPRESSIONS) {
            let is_join = matches!(
                step,
                Step::Event(
                    Event::SegmentStart(_, node)
                    | Event::SegmentEnd(_, node)
                    | Event::UnreachableSegmentStart(_, node)
                    | Event::UnreachableSegmentEnd(_, node)
                ) if Some(node) == chain
            );
            if !is_join && let Some(chain) = chain.take() {
                self.on_expression_exit(chain, cx);
                cx.state.segments_after_chain = None;
            }
            match step {
                Step::Event(Event::CodePathStart(path, node)) => self.on_code_path_start(path, node, cx),
                Step::Event(Event::CodePathEnd(path, node)) => self.on_code_path_end(path, node, cx),
                Step::Event(Event::SegmentStart(segment, node)) => self.on_segment_start(segment, node, cx),
                Step::Event(_) => {}
                Step::Enter(node) => self.on_identifier(node, cx),
                Step::Exit(node) if matches!(node, Node::Expr(e) if e.is_chain_root()) => chain = Some(node),
                Step::Exit(node) => self.on_expression_exit(node, cx),
            }
            if chain.is_some() {
                cx.state.segments_after_chain = cx.state.stack.last().map(|it| it.code_path.current_segments());
            }
        }
    }

    fn on_code_path_start<'a>(&self, code_path: CodePath<'a>, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        let scope = match node {
            Node::Func(func) if func.is_async() || func.is_generator() => func.scope(),
            _ => None,
        };
        let file = cx.file();
        let reference_map = scope.map(|scope| create_reference_map(scope, file, &mut cx.state.read_sets));
        cx.state.stack.push(Frame {
            code_path,
            reference_map,
        });
    }

    fn on_code_path_end<'a>(&self, _: CodePath<'a>, _: Node<'a>, cx: &mut Cx<'a, Self>) {
        let state = &mut cx.state;
        state.stack.pop();
        if !state.stack.iter().any(|it| it.reference_map.is_some()) {
            state.segment_info.clear();
            state.read_sets.clear();
        }
    }

    fn on_segment_start<'a>(&self, segment: Segment<'a>, _: Node<'a>, cx: &mut Cx<'a, Self>) {
        let state = &mut cx.state;
        if !state.stack.last().is_some_and(|it| it.reference_map.is_some()) {
            return;
        }
        let mut info = SegmentInfo::default();
        for prev_segment in segment.prev_segments() {
            if let Some(&prev) = state.segment_info.get(&prev_segment.id()) {
                info = state.read_sets.union(info, prev);
            }
        }
        state.segment_info.insert(segment.id(), info);
    }

    fn on_identifier<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        let state = &mut cx.state;
        let Some(Frame {
            code_path,
            reference_map: Some(reference_map),
        }) = state.stack.last()
        else {
            return;
        };
        let start = match node {
            Node::Expr(e) => e.span().start,
            Node::Pat(pat) if pat.tag() == PatTag::Ident => pat.span().start,
            _ => return,
        };
        let Some(&(reference, variable, number)) = reference_map.get(&start) else {
            return;
        };
        let code_path = *code_path;
        let is_member_access = match node {
            // ESLint has a `JSXIdentifier` there.
            Node::Expr(e) if e.is_jsx_tag_name() => return,
            Node::Expr(e) => {
                matches!(e.parent(), Node::Expr(parent) if matches!(parent.tag(), ExprTag::Dot | ExprTag::Index))
            }
            _ => false,
        };
        let write_expr = get_write_expr(reference);

        if reference.is_read() && !write_expr.is_some_and(is_right_of_plain_assignment) {
            for segment in code_path.current_segments() {
                if let Some(info) = state.segment_info.get_mut(&segment.id()) {
                    *info = state.read_sets.mark_as_read(*info, number);
                }
            }
        }

        if let Some(write_expr) = write_expr
            && assignment_of(write_expr).is_some()
            && !state.is_local_variable_without_escape(variable, is_member_access)
        {
            state.assignment_references.entry(write_expr).or_default().push((reference, variable, number));
        }
    }

    fn on_expression_exit<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        let state = &mut cx.state;
        let Some(Frame {
            code_path,
            reference_map: Some(_),
        }) = state.stack.last()
        else {
            return;
        };
        let (code_path, Node::Expr(e)) = (*code_path, node) else {
            return;
        };

        if matches!(e.tag(), ExprTag::Await | ExprTag::Yield) {
            for segment in code_path.current_segments() {
                if let Some(info) = state.segment_info.get_mut(&segment.id()) {
                    *info = state.read_sets.make_outdated(*info);
                }
            }
        }

        // `<T>e` is a `TSTypeAssertion`, which `:expression` does not match.
        if state.assignment_references.is_empty() || e.is_angle_bracket_assertion() {
            return;
        }
        let Some(references) = state.assignment_references.remove(&e) else {
            return;
        };
        let Some(assignment) = assignment_of(e) else {
            return;
        };
        let segments = cx.state.segments_after_chain.take().unwrap_or_else(|| code_path.current_segments());
        for (reference, variable, number) in references {
            let is_outdated = segments.iter().any(|segment| {
                let info = cx.state.segment_info.get(&segment.id());
                info.is_some_and(|&it| cx.state.read_sets.is_outdated(it, number))
            });
            if !is_outdated {
                continue;
            }
            if assignment.is_left_identifier && assignment.left.start == reference.ident().start() {
                cx.report(assignment.span, NON_ATOMIC_UPDATE).data("value", variable.name());
            } else if !self.allow_properties {
                cx.report(assignment.span, NON_ATOMIC_OBJECT_UPDATE)
                    .data("value", cx.slice(assignment.left))
                    .data("object", variable.name());
            }
        }
    }
}

impl Rule for RequireAtomicUpdates {
    const META: Meta = Meta::eslint("require-atomic-updates", Kind::Problem).reports_on_exit();
    const ON: On = On::new().funcs();
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        RequireAtomicUpdates {
            allow_properties: options.object(0).bool_or("allowProperties", false),
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<State<'a>> {
        // Nothing is outdated without one of them.
        if !file.has_exprs([ExprTag::Await, ExprTag::Yield]) {
            return None;
        }
        Some(State::default())
    }

    fn func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        if (func.is_async() || func.is_generator()) && func.has_body() {
            self.check_function(func, cx);
        }
    }
}

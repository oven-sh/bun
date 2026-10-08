use bun_core::strings;
use bun_lint::prelude::*;
use rustc_hash::{FxHashMap, FxHashSet};
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

/// By where the identifier starts.
type ReferenceMap<'a> = FxHashMap<u32, (Reference<'a>, Variable<'a>)>;

/// The references in `scope`, which is that of a function, without those in nested functions.
fn create_reference_map<'a>(scope: Scope<'a>, file: &'a File<'a>) -> ReferenceMap<'a> {
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
            map.insert(reference.ident().start(), (reference, variable));
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
fn is_local_variable_without_escape(variable: Variable, is_member_access: bool) -> bool {
    // It is referred to from a function, which is not where it is declared.
    let Variable::Declared(symbol) = variable else {
        return false;
    };
    if is_member_access && symbol.declarations().any(|def| matches!(def, Declaration::Param(_))) {
        return false;
    }
    let function_scope = symbol.scope().variable_scope();
    symbol.references().all(|reference| reference.scope().variable_scope() == function_scope)
}

#[derive(Default)]
struct SegmentInfo<'a> {
    outdated_read_variables: FxHashSet<Variable<'a>>,
    fresh_read_variables: FxHashSet<Variable<'a>>,
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
    segment_info: FxHashMap<u32, SegmentInfo<'a>>,
    /// By what is assigned: the references to verify once that has been evaluated.
    assignment_references: FxHashMap<Expr<'a>, SmallVec<[(Reference<'a>, Variable<'a>); 1]>>,
}

impl RequireAtomicUpdates {
    fn on_code_path_start<'a>(&self, code_path: CodePath<'a>, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        let scope = match node {
            Node::Func(func) if func.is_async() || func.is_generator() => func.scope(),
            _ => None,
        };
        let reference_map = scope.map(|scope| create_reference_map(scope, cx.file()));
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
        }
    }

    fn on_segment_start<'a>(&self, segment: Segment<'a>, _: Node<'a>, cx: &mut Cx<'a, Self>) {
        let state = &mut cx.state;
        if !state.stack.last().is_some_and(|it| it.reference_map.is_some()) {
            return;
        }
        let mut info = SegmentInfo::default();
        for prev_segment in segment.prev_segments() {
            if let Some(prev) = state.segment_info.get(&prev_segment.id()) {
                info.outdated_read_variables.extend(prev.outdated_read_variables.iter().copied());
                info.fresh_read_variables.extend(prev.fresh_read_variables.iter().copied());
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
        let Some(&(reference, variable)) = reference_map.get(&start) else {
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
                    info.fresh_read_variables.insert(variable);
                    info.outdated_read_variables.remove(&variable);
                }
            }
        }

        if let Some(write_expr) = write_expr
            && assignment_of(write_expr).is_some()
            && !is_local_variable_without_escape(variable, is_member_access)
        {
            state.assignment_references.entry(write_expr).or_default().push((reference, variable));
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
                    info.outdated_read_variables.extend(info.fresh_read_variables.drain());
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
        let segments = code_path.current_segments();
        for (reference, variable) in references {
            let is_outdated = segments.iter().any(|segment| {
                let info = cx.state.segment_info.get(&segment.id());
                info.is_some_and(|it| it.outdated_read_variables.contains(&variable))
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
    const META: Meta = Meta::eslint("require-atomic-updates", Kind::Problem);
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        RequireAtomicUpdates {
            allow_properties: options.object(0).bool_or("allowProperties", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> State<'a> {
        // Nothing is outdated without one of them, and then the file need not be walked.
        if !strings::contains(file.text(), b"await") && !strings::contains(file.text(), b"yield") {
            return State::default();
        }
        on.code_path_start(Self::on_code_path_start);
        on.code_path_end(Self::on_code_path_end);
        on.segment_start(Self::on_segment_start);
        on.enter(NodeTags::PAT | ExprTag::Ident.into(), Self::on_identifier);
        // What `:expression` matches.
        on.exit(
            [
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
            ],
            Self::on_expression_exit,
        );
        State::default()
    }
}

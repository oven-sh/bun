use bun_lint::prelude::*;
use bun_lint::utils::string_utils::upper_case_first;
use bun_lint::utils::{ast_utils, is_assignment_target};
use rustc_hash::FxHashMap;

/// Enforce a maximum cyclomatic complexity allowed in a program.
pub struct Complexity {
    /// `None`: nothing is too complex.
    threshold: Option<usize>,
    is_modified: bool,
}

const COMPLEX: Message = Message::new(
    "complex",
    "{{name}} has a complexity of {{complexity}}. Maximum allowed is {{max}}.",
);

const THRESHOLD_DEFAULT: usize = 20;

/// Whether `node` is the value of the `PropertyDefinition` `member`, which has a code path of its
/// own.
fn is_field_initializer<'a>(member: Member<'a>, node: Node<'a>) -> bool {
    member.init().map(Node::Expr) == Some(node)
        && !member.flags().intersects(Flags::ACCESSOR | Flags::ABSTRACT)
}

/// What a walk from a node towards the root finds, for a rule that asks that of many nodes.
///
/// A long walk leaves what it has found at every [`Climber::STRIDE`]th node on its way, and a walk
/// that comes to such a node ends there. So all the walks in a file together take
/// O(nodes + walks) steps, however deep the nodes are in each other.
pub struct Climber<'a, T> {
    /// What the walk from a node finds, and how many steps of it count.
    known: FxHashMap<Node<'a>, (T, u32)>,
}

/// What a walk does on the step from a node to its parent.
pub(crate) enum Step<T> {
    /// It ends and has found this.
    Stop(T),
    /// It goes on, and the step is counted.
    Count,
    Pass,
}

impl<T> Default for Climber<'_, T> {
    fn default() -> Self {
        Climber {
            known: FxHashMap::default(),
        }
    }
}

impl<'a, T: Copy> Climber<'a, T> {
    const STRIDE: u32 = 32;

    /// Walks from `start` to the root. `step` gets a node and its parent and depends on nothing
    /// else. Returns what the walk finds, `at_root` if nothing stops it, and how many steps count.
    pub(crate) fn climb(
        &mut self,
        start: Node<'a>,
        at_root: T,
        step: impl Fn(Node<'a>, Node<'a>) -> Step<T>,
    ) -> (T, u32) {
        let (mut at, mut steps, mut count) = (start, 0u32, 0u32);
        let found = loop {
            if !self.known.is_empty()
                && let Some(&(found, above)) = self.known.get(&at)
            {
                count += above;
                break found;
            }
            if matches!(at, Node::File(_)) {
                break at_root;
            }
            let parent = at.parent();
            match step(at, parent) {
                Step::Stop(found) => break found,
                Step::Count => count += 1,
                Step::Pass => {}
            }
            (at, steps) = (parent, steps + 1);
        };
        if steps >= Self::STRIDE {
            let (mut at, mut above) = (start, count);
            for i in 0..steps {
                if i % Self::STRIDE == 0 {
                    self.known.insert(at, (found, above));
                }
                let parent = at.parent();
                if matches!(step(at, parent), Step::Count) {
                    above = above.saturating_sub(1);
                }
                at = parent;
            }
        }
        (found, count)
    }
}

#[derive(Default)]
pub struct State<'a> {
    /// The complexity of each code path that has more than one route.
    complexities: FxHashMap<Node<'a>, usize>,
    owners: Climber<'a, Option<Node<'a>>>,
}

impl Complexity {
    /// Adds to the complexity of what has the code path that `node` is in: the `Func` of a function
    /// or of a static block, or the `Member` whose initializer it is in. Nothing at the top level.
    fn increase<'a>(node: impl Into<Node<'a>>, by: usize, cx: &mut Cx<'a, Self>) {
        let (owner, _) = cx.state.owners.climb(node.into(), None, |inner, ancestor| match ancestor {
            Node::Func(func) if func.has_body() => Step::Stop(Some(ancestor)),
            Node::Member(member) if is_field_initializer(member, inner) => Step::Stop(Some(ancestor)),
            _ => Step::Pass,
        });
        if let Some(owner) = owner {
            *cx.state.complexities.entry(owner).or_insert(1) += by;
        }
    }

    fn check_expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let counts = match e.kind() {
            ExprKind::Cond { .. } => true,
            ExprKind::Binary { op, .. } => matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish),
            // A default value in the target of a destructuring assignment.
            ExprKind::Assign { op: None, .. } => {
                matches!(e.parent(), Node::Expr(_) | Node::Prop(_)) && is_assignment_target(e)
            }
            ExprKind::Assign { op, .. } => ast_utils::is_logical_assignment_operator(op),
            _ => e.is_optional(),
        };
        if counts {
            Self::increase(e, 1, cx);
        }
    }

    fn report_all<'a>(&self, cx: &mut Cx<'a, Self>) {
        let Some(threshold) = self.threshold else {
            return;
        };
        for (&owner, &complexity) in &cx.state.complexities {
            if complexity <= threshold {
                continue;
            }
            let (name, loc) = match owner {
                Node::Member(member) => (
                    b"Class field initializer".to_vec(),
                    member.init().map_or_else(|| member.span(), Expr::span),
                ),
                Node::Func(func) if func.kind() == FnKind::StaticBlock => {
                    let start = func.span().start;
                    (
                        b"Class static block".to_vec(),
                        Span::new(start, start + "static".len() as u32),
                    )
                }
                Node::Func(func) => (
                    upper_case_first(&ast_utils::get_function_name_with_kind(func)).into_owned(),
                    ast_utils::get_function_head_loc(func),
                ),
                _ => continue,
            };
            cx.report(loc, COMPLEX)
                .data("name", name)
                .data("complexity", complexity)
                .data("max", threshold);
        }
    }
}

impl Rule for Complexity {
    const META: Meta = Meta::eslint("complexity", Kind::Suggestion);
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        Complexity {
            threshold: match options.number(0) {
                Some(n) => Some(n as usize),
                None if object.has("maximum") || object.has("max") => {
                    object.usize("maximum").filter(|n| *n != 0).or_else(|| object.usize("max"))
                }
                None => Some(THRESHOLD_DEFAULT),
            },
            is_modified: object.str("variant") == Some("modified"),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> Self::State<'a> {
        let Some(threshold) = self.threshold else {
            return State::default();
        };
        if threshold == 0 {
            on.funcs(|_, func, cx| {
                if func.has_body() {
                    cx.state.complexities.entry(Node::Func(func)).or_insert(1);
                }
            });
            on.members(|_, member, cx| {
                if let Some(init) = member.init()
                    && is_field_initializer(member, Node::Expr(init))
                {
                    cx.state.complexities.entry(Node::Member(member)).or_insert(1);
                }
            });
        }
        on.exprs(
            [
                ExprTag::Cond,
                ExprTag::Binary,
                ExprTag::Assign,
                ExprTag::Dot,
                ExprTag::Index,
                ExprTag::Call,
            ],
            Self::check_expr,
        );
        on.stmts(
            [
                StmtTag::If,
                StmtTag::For,
                StmtTag::ForIn,
                StmtTag::ForOf,
                StmtTag::While,
                StmtTag::DoWhile,
            ],
            |_, stmt, cx| Self::increase(stmt, 1, cx),
        );
        on.stmts([StmtTag::Try], |_, stmt, cx| {
            if matches!(stmt.kind(), StmtKind::Try { handler: Some(_), .. }) {
                Self::increase(stmt, 1, cx);
            }
        });
        on.params(|_, param, cx| {
            if param.default().is_some() {
                Self::increase(param, 1, cx);
            }
        });
        on.pats([PatTag::Object, PatTag::Array], |_, pat, cx| {
            let defaults = match pat.kind() {
                PatKind::Object(props) => props.iter().filter(|it| it.default().is_some()).count(),
                PatKind::Array(elems) => elems.iter().filter(|it| it.default().is_some()).count(),
                _ => 0,
            };
            if defaults > 0 {
                Self::increase(pat, defaults, cx);
            }
        });
        if self.is_modified {
            on.stmts([StmtTag::Switch], |_, stmt, cx| Self::increase(stmt, 1, cx));
        } else {
            on.cases(|_, case, cx| {
                if !case.is_default() {
                    Self::increase(case, 1, cx);
                }
            });
        }
        on.finish(Self::report_all);
        State::default()
    }
}

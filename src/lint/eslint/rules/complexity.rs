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

/// What has the code path that `node` is in: the `Func` of a function or of a static block, or the
/// `Member` whose initializer it is in. `None` at the top level.
fn code_path_owner(node: Node<'_>) -> Option<Node<'_>> {
    let mut inner = node;
    for ancestor in node.ancestors() {
        match ancestor {
            Node::Func(func) if func.has_body() => return Some(ancestor),
            Node::Member(member) if is_field_initializer(member, inner) => return Some(ancestor),
            _ => inner = ancestor,
        }
    }
    None
}

impl Complexity {
    fn increase<'a>(node: impl Into<Node<'a>>, by: usize, cx: &mut Cx<'a, Self>) {
        if let Some(owner) = code_path_owner(node.into()) {
            *cx.state.entry(owner).or_insert(1) += by;
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
        for (&owner, &complexity) in &cx.state {
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
    /// The complexity of each code path that has more than one route.
    type State<'a> = FxHashMap<Node<'a>, usize>;

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
            return FxHashMap::default();
        };
        if threshold == 0 {
            on.funcs(|_, func, cx| {
                if func.has_body() {
                    cx.state.entry(Node::Func(func)).or_insert(1);
                }
            });
            on.members(|_, member, cx| {
                if let Some(init) = member.init()
                    && is_field_initializer(member, Node::Expr(init))
                {
                    cx.state.entry(Node::Member(member)).or_insert(1);
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
        FxHashMap::default()
    }
}

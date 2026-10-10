use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint::utils::string_utils::upper_case_first;
use bun_lint::utils::{ast_utils, is_assignment_target, oxlint};
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

#[derive(Default)]
pub struct State<'a> {
    /// The complexity of each code path that has more than one route.
    complexities: FxHashMap<Node<'a>, usize>,
    owners: AncestorMemo<'a, Node<'a>>,
}

impl Complexity {
    /// Adds to the complexity of what has the code path that `node` is in: the `Func` of a function
    /// or of a static block, or the `Member` whose initializer it is in. Nothing at the top level.
    fn increase<'a>(node: impl Into<Node<'a>>, by: usize, cx: &mut Cx<'a, Self>) {
        let owner = cx.state.owners.find(node.into(), |inner, ancestor| match ancestor {
            Node::Func(func) if func.has_body() => Some(ancestor),
            Node::Member(member) if is_field_initializer(member, inner) => Some(ancestor),
            _ => None,
        });
        if let Some(owner) = owner {
            *cx.state.complexities.entry(owner).or_insert(1) += by;
        }
    }
}

impl Rule for Complexity {
    const META: Meta = Meta::eslint("complexity", Kind::Suggestion);
    const ON: On = On::new()
        .exprs(&[
            ExprTag::Cond,
            ExprTag::Binary,
            ExprTag::Assign,
            ExprTag::Dot,
            ExprTag::Index,
            ExprTag::Call,
        ])
        .stmts(&[
            StmtTag::If,
            StmtTag::For,
            StmtTag::ForIn,
            StmtTag::ForOf,
            StmtTag::While,
            StmtTag::DoWhile,
            StmtTag::Try,
            StmtTag::Switch,
        ])
        .pats(&[PatTag::Object, PatTag::Array])
        .funcs()
        .members()
        .params()
        .cases()
        .finish();
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

    fn narrow<'a>(&self, _: &'a File<'a>) -> On {
        let mut on = On::new()
            .exprs(&[
                ExprTag::Cond,
                ExprTag::Binary,
                ExprTag::Assign,
                ExprTag::Dot,
                ExprTag::Index,
                ExprTag::Call,
            ])
            .stmts(&[
                StmtTag::If,
                StmtTag::For,
                StmtTag::ForIn,
                StmtTag::ForOf,
                StmtTag::While,
                StmtTag::DoWhile,
                StmtTag::Try,
            ])
            .params()
            .pats(&[PatTag::Object, PatTag::Array])
            .finish();
        if self.threshold == Some(0) {
            on = on.funcs().members();
        }
        match self.is_modified {
            true => on.stmts(&[StmtTag::Switch]),
            false => on.cases(),
        }
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Self::State<'a>> {
        self.threshold.is_some().then(State::default)
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let counts = match e.kind() {
            ExprKind::Cond { .. } => true,
            ExprKind::Binary { op, .. } => matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish),
            // A default value in the target of a destructuring assignment.
            // oxlint does not count it.
            ExprKind::Assign { op: None, .. } => {
                !cx.language().is_oxlint
                    && matches!(e.parent(), Node::Expr(_) | Node::Prop(_))
                    && is_assignment_target(e)
            }
            ExprKind::Assign { op, .. } => ast_utils::is_logical_assignment_operator(op),
            _ => e.is_optional(),
        };
        if counts {
            Self::increase(e, 1, cx);
        }
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        match stmt.tag() {
            StmtTag::If | StmtTag::For | StmtTag::ForIn | StmtTag::ForOf | StmtTag::While | StmtTag::DoWhile => {
                Self::increase(stmt, 1, cx);
            }
            StmtTag::Try => {
                if matches!(stmt.kind(), StmtKind::Try { handler: Some(_), .. }) {
                    Self::increase(stmt, 1, cx);
                }
            }
            StmtTag::Switch => Self::increase(stmt, 1, cx),
            _ => {}
        }
    }

    fn pat<'a>(&self, pat: Pat<'a>, cx: &mut Cx<'a, Self>) {
        let defaults = match pat.kind() {
            PatKind::Object(props) => props.iter().filter(|it| it.default().is_some()).count(),
            PatKind::Array(elems) => elems.iter().filter(|it| it.default().is_some()).count(),
            _ => 0,
        };
        if defaults > 0 {
            Self::increase(pat, defaults, cx);
        }
    }

    fn func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        if func.has_body() {
            cx.state.complexities.entry(Node::Func(func)).or_insert(1);
        }
    }

    fn member<'a>(&self, member: Member<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(init) = member.init()
            && is_field_initializer(member, Node::Expr(init))
        {
            cx.state.complexities.entry(Node::Member(member)).or_insert(1);
        }
    }

    fn param<'a>(&self, param: Param<'a>, cx: &mut Cx<'a, Self>) {
        if param.default().is_some() {
            Self::increase(param, 1, cx);
        }
    }

    fn case<'a>(&self, case: Case<'a>, cx: &mut Cx<'a, Self>) {
        if !case.is_default() {
            Self::increase(case, 1, cx);
        }
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let Some(threshold) = self.threshold else {
            return;
        };
        for (&owner, &complexity) in &cx.state.complexities {
            if complexity <= threshold {
                continue;
            }
            let is_oxlint = cx.language().is_oxlint;
            let (name, loc) = match owner {
                Node::Member(member) => (
                    if is_oxlint { b"class field initializer".to_vec() } else { b"Class field initializer".to_vec() },
                    member.init().map_or_else(|| member.span(), Expr::span),
                ),
                Node::Func(func) if func.kind() == FnKind::StaticBlock => {
                    let whole = func.span();
                    // oxlint points at the whole block.
                    match is_oxlint {
                        true => (b"class static block".to_vec(), whole),
                        false => {
                            let keyword = Span::new(whole.start, whole.start + "static".len() as u32);
                            (b"Class static block".to_vec(), keyword)
                        }
                    }
                }
                // oxlint points at the function.
                Node::Func(func) if is_oxlint => (oxlint::get_function_name_with_kind(func), func.estree_span()),
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

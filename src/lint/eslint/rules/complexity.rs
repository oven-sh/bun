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
    /// What adds to the complexity of the code path that it is in: where it starts, how much it adds, and what it is.
    found: Vec<(u32, usize, Node<'a>)>,
    /// By the index of a function: the complexity of its code path. 0: it is not known to have more than one route.
    of_functions: Vec<usize>,
    /// The same for the initializers of fields, of which few have more than one.
    of_fields: FxHashMap<Member<'a>, usize>,
    owners: AncestorMemo<'a, Node<'a>>,
}

impl Complexity {
    fn increase<'a>(node: impl Into<Node<'a>> + Spanned, by: usize, cx: &mut Cx<'a, Self>) {
        cx.state.found.push((node.span().start, by, node.into()));
    }

    /// Finds the complexity of each code path that can be above `threshold`.
    fn count<'a>(threshold: usize, cx: &mut Cx<'a, Self>) {
        let found = std::mem::take(&mut cx.state.found);
        // A complexity is one more than what is added to it.
        if found.iter().map(|it| it.1).sum::<usize>() < threshold {
            return;
        }
        // For each function that is in no function: where all that is written is in it, and how much that adds, be it to the
        // function or to a code path in it.
        let inside = |func: Func<'a>| {
            let whole = func.span();
            let start = match func.open_paren() {
                Some(open) => func
                    .type_params()
                    .first()
                    .map_or(open, |it| it.span().start),
                None => whole.start,
            };
            (Span::new(start, whole.end), 0)
        };
        let outermost = cx
            .file()
            .funcs()
            .filter(|it| it.has_body() && it.enclosing().is_none());
        let mut outermost: Vec<(Span, usize)> = outermost.map(inside).collect();
        utils::sort::sort_unstable_by_key(&mut outermost, |it| it.0.start);
        // The last that starts before what has been found.
        let mut at = 0;
        let mut around = Vec::with_capacity(found.len());
        for &(start, by, _) in &found {
            let is_at = outermost.get(at).is_some_and(|it| it.0.start <= start)
                && outermost.get(at + 1).is_none_or(|it| start < it.0.start);
            if !is_at {
                at = outermost
                    .partition_point(|it| it.0.start <= start)
                    .wrapping_sub(1);
            }
            around.push(match outermost.get_mut(at).filter(|it| start < it.0.end) {
                Some(function) => {
                    function.1 += by;
                    at
                }
                None => usize::MAX,
            });
        }
        for (&(_, by, node), around) in found.iter().zip(around) {
            if outermost.get(around).is_none_or(|it| it.1 >= threshold) {
                Self::add(node, by, cx);
            }
        }
    }

    /// Adds to the complexity of what has the code path that `node` is in: the `Func` of a function
    /// or of a static block, or the `Member` whose initializer it is in. Nothing at the top level.
    fn add<'a>(node: Node<'a>, by: usize, cx: &mut Cx<'a, Self>) {
        let owner = cx
            .state
            .owners
            .find(node, |inner, ancestor| match ancestor {
                Node::Func(func) if func.has_body() => Some(ancestor),
                Node::Member(member) if is_field_initializer(member, inner) => Some(ancestor),
                _ => None,
            });
        match owner {
            Some(Node::Func(func)) => Self::increase_function(func, by, cx),
            Some(Node::Member(member)) => *cx.state.of_fields.entry(member).or_insert(1) += by,
            _ => {}
        }
    }

    fn increase_function<'a>(func: Func<'a>, by: usize, cx: &mut Cx<'a, Self>) {
        let (at, known) = (func.id().idx(), &mut cx.state.of_functions);
        if at >= known.len() {
            known.resize(at + 1, 0);
        }
        if let Some(complexity) = known.get_mut(at) {
            *complexity = (*complexity).max(1) + by;
        }
    }

    fn report<'a>(&self, owner: Node<'a>, complexity: usize, cx: &Cx<'a, Self>) {
        let Some(threshold) = self.threshold.filter(|it| complexity > *it) else {
            return;
        };
        let is_oxlint = cx.language().is_oxlint;
        let (name, loc) = match owner {
            // oxlint points at the parentheses too.
            Node::Member(member) if is_oxlint => (
                b"class field initializer".to_vec(),
                member
                    .init()
                    .map_or_else(|| member.span(), Expr::outer_span),
            ),
            Node::Member(member) => (
                b"Class field initializer".to_vec(),
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
            Node::Func(func) if is_oxlint => (
                oxlint::get_function_name_with_kind(func),
                func.estree_span(),
            ),
            Node::Func(func) => (
                upper_case_first(&ast_utils::get_function_name_with_kind(func)).into_owned(),
                ast_utils::get_function_head_loc(func),
            ),
            _ => return,
        };
        cx.report(loc, COMPLEX)
            .called_with(owner)
            .data("name", name)
            .data("complexity", complexity)
            .data("max", threshold);
    }
}

impl Rule for Complexity {
    const META: Meta = Meta::eslint("complexity", Kind::Suggestion).reports_on_code_path_end();
    const ON: On = On::new()
        .exprs(&[ExprTag::Cond, ExprTag::Assign])
        .optional_chains()
        .binaries(&[BinOp::And, BinOp::Or, BinOp::Nullish])
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
                None if object.has("maximum") || object.has("max") => object
                    .usize("maximum")
                    .filter(|n| *n != 0)
                    .or_else(|| object.usize("max")),
                None => Some(THRESHOLD_DEFAULT),
            },
            is_modified: object.str("variant") == Some("modified"),
        }
    }

    fn narrow<'a>(&self, _: &'a File<'a>) -> On {
        let mut on = On::new()
            .exprs(&[ExprTag::Cond, ExprTag::Assign])
            .optional_chains()
            .binaries(&[BinOp::And, BinOp::Or, BinOp::Nullish])
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
        let counts = match e.assign_op() {
            // A `Cond`.
            None => true,
            // A default value in the target of a destructuring assignment.
            // oxlint does not count it.
            Some(None) => {
                !cx.language().is_oxlint
                    && matches!(e.parent(), Node::Expr(_) | Node::Prop(_))
                    && is_assignment_target(e)
            }
            Some(op) => ast_utils::is_logical_assignment_operator(op),
        };
        if counts {
            Self::increase(e, 1, cx);
        }
    }

    fn optional_chain<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if e.is_optional() {
            Self::increase(e, 1, cx);
        }
    }

    fn binary<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        Self::increase(e, 1, cx);
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        match stmt.tag() {
            StmtTag::If
            | StmtTag::For
            | StmtTag::ForIn
            | StmtTag::ForOf
            | StmtTag::While
            | StmtTag::DoWhile => {
                Self::increase(stmt, 1, cx);
            }
            StmtTag::Try => {
                if matches!(
                    stmt.kind(),
                    StmtKind::Try {
                        handler: Some(_),
                        ..
                    }
                ) {
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
            Self::increase_function(func, 0, cx);
        }
    }

    fn member<'a>(&self, member: Member<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(init) = member.init()
            && is_field_initializer(member, Node::Expr(init))
        {
            cx.state.of_fields.entry(member).or_insert(1);
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
        Self::count(threshold, cx);
        // oxlint reports an initializer that is a function and the function at one place: the initializer first.
        for (&member, &complexity) in
            utils::sort::in_order_of(&cx.state.of_fields, |it| it.0.span().start)
        {
            self.report(Node::Member(member), complexity, cx);
        }
        let of_functions = &cx.state.of_functions;
        if of_functions.iter().all(|it| *it <= threshold) {
            return;
        }
        for func in cx.file().funcs() {
            let complexity = of_functions.get(func.id().idx());
            self.report(Node::Func(func), complexity.copied().unwrap_or(0), cx);
        }
    }
}

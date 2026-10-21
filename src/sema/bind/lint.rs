//! Computes what a linter without a checker needs to know about a file: each node's parent, each
//! expression's kind, and for each function its enclosing function and where it returns and yields.
//!
//! All of it comes from the file's node lists, where a node comes after its children and the
//! children are in source order. Nothing here recurses, and nothing is declared or resolved.

use super::*;
use crate::util::SharedSort;

/// Fills in `b` as [`bind_for_lint_in`] describes. Returns false if the file needs the binder.
pub(super) fn fill_in<S: Storage>(f: &FileIn<S>, b: &mut BoundBuilder) -> bool {
    if !parents::fill_in::<S, true>(f, b) || !functions(f, b) {
        return false;
    }
    if b.expr_kind_counts
        .get(2 * ExprTag::Yield as usize)
        .is_some_and(|count| *count > 0)
    {
        Yields::new(f, b).list();
    }
    true
}

/// The end of the function that `owner` owns.
#[inline]
fn end_of<S: Storage>(f: &FileIn<S>, owner: FnOwner) -> u32 {
    match owner {
        FnOwner::Expr(e) => f.exprs.get(e.idx()).map_or(0, |it| it.end),
        FnOwner::Stmt(s) => f.stmts.get(s.idx()).map_or(0, |it| it.loc.end),
        FnOwner::Member(m) => f.members.get(m.idx()).map_or(0, |it| it.loc.end),
        FnOwner::Type(t) => f.types.get(t.idx()).map_or(0, |it| it.end),
        FnOwner::None => 0,
    }
}

/// The position from which the source text is inside the function. That's after its decorators and
/// its name, which can be computed.
#[inline]
fn start_of<S: Storage>(f: &FileIn<S>, func: &Func) -> u32 {
    match (
        func.kind,
        f.type_params.get(func.type_params.start as usize),
    ) {
        (FnKind::Arrow | FnKind::StaticBlock, _) => func.start,
        (_, Some(first)) if !func.type_params.is_empty() => first.start,
        _ => func.anchor,
    }
}

/// Fills in `FnInfo::enclosing` and `FnInfo::returns`. On entry, `b.ids` has the file's `return`
/// statements.
///
/// A function comes after the functions nested in it, so anything in its range that no earlier
/// function has claimed is directly in it. Returns false if the lists aren't in that order.
fn functions<S: Storage>(f: &FileIn<S>, b: &mut BoundBuilder) -> bool {
    let (fns, ids) = (&mut b.fns[..], &mut b.ids);
    // A linked list of the functions that no function has claimed yet. This is the last one, and
    // each one's `enclosing` temporarily points to the one before it.
    let mut open = FnId::NONE;
    // The unclaimed `return` statements are `ids[..pending]`. Those at `ids[read..found]` end after
    // every function seen so far.
    let (mut pending, mut read, found) = (0, 0, ids.len());
    // The end of the last `return` statement read.
    let mut last_return = 0;
    for (i, func) in f.fns.iter().enumerate() {
        let (start, end) = (start_of(f, func), end_of(f, fns[i].owner));
        while let (Some(inner), Some(info)) = (f.fns.get(open.idx()), fns.get_mut(open.idx()))
            && inner.start >= start
        {
            if end_of(f, info.owner) > end {
                return false;
            }
            open = std::mem::replace(&mut info.enclosing, FnId(i as u32));
        }
        if fns
            .get(open.idx())
            .is_some_and(|before| end_of(f, before.owner) > start)
        {
            return false;
        }
        fns[i].enclosing = std::mem::replace(&mut open, FnId(i as u32));
        if !matches!(func.body, FnBody::Block(_)) {
            continue;
        }
        while read < found
            && let Some(statement) = f.stmts.get(ids[read] as usize)
            && statement.loc.end <= end
            // `return function () {}` ends where the function ends.
            && (statement.start >= start || statement.loc.end <= start)
        {
            if statement.loc.end < last_return {
                return false;
            }
            last_return = statement.loc.end;
            ids[pending] = ids[read];
            (pending, read) = (pending + 1, read + 1);
        }
        let is_inside = |s: &u32| f.stmts.get(*s as usize).is_some_and(|it| it.start >= start);
        let first = pending
            - ids[..pending]
                .iter()
                .rev()
                .take_while(|s| is_inside(s))
                .count();
        if first < pending {
            fns[i].returns = IdList::new(ids.len() as u32, (pending - first) as u32);
            ids.extend_from_within(first..pending);
            pending = first;
        }
    }
    while let Some(info) = fns.get_mut(open.idx()) {
        open = std::mem::replace(&mut info.enclosing, FnId::NONE);
    }
    true
}

/// A node on the path up from a `yield`.
#[derive(Copy, Clone)]
enum Ancestor {
    Expr(ExprId),
    Stmt(StmtId),
    Pat(PatId),
}

enum Next {
    At(Ancestor),
    /// The function that the `yield` belongs to, or `NONE` if there isn't one.
    Is(FnId),
}

/// Fills in `FnInfo::yields` with what `forEachYieldExpression` finds.
struct Yields<'l, S: Storage> {
    f: &'l FileIn<S>,
    b: &'l mut BoundBuilder,
    /// For each node that a walk has passed through, the function where that walk ended.
    fn_of_expr: Vec<Option<FnId>>,
    fn_of_stmt: Vec<Option<FnId>>,
    fn_of_pat: Vec<Option<FnId>>,
}

impl<'l, S: Storage> Yields<'l, S> {
    fn new(f: &'l FileIn<S>, b: &'l mut BoundBuilder) -> Self {
        Yields {
            fn_of_expr: vec![None; f.exprs.len()],
            fn_of_stmt: vec![None; f.stmts.len()],
            fn_of_pat: vec![None; f.pats.len()],
            f,
            b,
        }
    }

    fn list(&mut self) {
        let f = self.f;
        let mut found: Vec<(FnId, u32)> = Vec::new();
        let mut passed: Vec<Ancestor> = Vec::new();
        for (i, e) in f.exprs.iter().enumerate() {
            if let ExprKind::Yield { .. } = e.kind {
                let function = self.function_of(ExprId(i as u32), &mut passed);
                if function.is_some() {
                    found.push((function, i as u32));
                }
            }
        }
        found.shared_sort_unstable_by_key(|it| (it.0.0, it.1));
        for yields_of_fn in found.chunk_by(|a, b| a.0 == b.0) {
            if let Some(info) = self.b.fns.get_mut(yields_of_fn[0].0.idx()) {
                info.yields = IdList::new(self.b.ids.len() as u32, yields_of_fn.len() as u32);
                self.b.ids.extend(yields_of_fn.iter().map(|it| it.1));
            }
        }
    }

    /// Walks up from `e` to its function. Each node is only walked through once, because a later
    /// walk that reaches it reuses the cached result.
    fn function_of(&mut self, e: ExprId, passed: &mut Vec<Ancestor>) -> FnId {
        let mut at = Ancestor::Expr(e);
        let function = loop {
            let known = match at {
                Ancestor::Expr(it) => self.fn_of_expr.get_mut(it.idx()),
                Ancestor::Stmt(it) => self.fn_of_stmt.get_mut(it.idx()),
                Ancestor::Pat(it) => self.fn_of_pat.get_mut(it.idx()),
            };
            match known {
                None => break FnId::NONE,
                Some(&mut Some(function)) => break function,
                // A placeholder until the walk ends.
                Some(unknown) => *unknown = Some(FnId::NONE),
            }
            passed.push(at);
            match self.above(at) {
                Next::At(above) => at = above,
                Next::Is(function) => break function,
            }
        };
        for ancestor in passed.drain(..) {
            match ancestor {
                Ancestor::Expr(it) => self.fn_of_expr[it.idx()] = Some(function),
                Ancestor::Stmt(it) => self.fn_of_stmt[it.idx()] = Some(function),
                Ancestor::Pat(it) => self.fn_of_pat[it.idx()] = Some(function),
            }
        }
        function
    }

    fn above(&self, at: Ancestor) -> Next {
        const NOWHERE: Next = Next::Is(FnId::NONE);
        let (f, b) = (self.f, &*self.b);
        let statement = |s: Option<&StmtId>| s.map_or(NOWHERE, |&s| Next::At(Ancestor::Stmt(s)));
        let function = |func: Option<&FnId>| func.map_or(NOWHERE, |&func| Next::Is(func));
        let class = |c: ClassId| match b.class_owner.get(c.idx()) {
            Some(&ClassOwner::Expr(e)) => Next::At(Ancestor::Expr(e)),
            Some(&ClassOwner::Stmt(s)) => Next::At(Ancestor::Stmt(s)),
            None => NOWHERE,
        };
        // `forEachYieldExpression` doesn't descend into types.
        let class_of = |m: MemberId| match b.member_owner.get(m.idx()) {
            Some(&MemberOwner::Class(c)) => class(c),
            _ => NOWHERE,
        };
        match at {
            Ancestor::Expr(e) => match b.parent_of_expr(e) {
                Parent::Expr(above) => Next::At(Ancestor::Expr(above)),
                Parent::Stmt(s) => Next::At(Ancestor::Stmt(s)),
                Parent::VarInit(d) => statement(b.var_stmt.get(d.idx())),
                Parent::Case(c) => statement(b.case_stmt.get(c.idx())),
                Parent::ParamDefault(p) => function(b.param_fn.get(p.idx())),
                Parent::PatPropDefault(p) | Parent::PatKey(p) => f
                    .pat_props
                    .get(p.idx())
                    .map_or(NOWHERE, |it| Next::At(Ancestor::Pat(it.value))),
                Parent::PatElemDefault(p) => f
                    .pat_elems
                    .get(p.idx())
                    .map_or(NOWHERE, |it| Next::At(Ancestor::Pat(it.pat))),
                Parent::Prop(p) | Parent::PropKey(p) | Parent::MethodKey(p) => b
                    .prop_owner
                    .get(p.idx())
                    .map_or(NOWHERE, |&it| Next::At(Ancestor::Expr(it))),
                Parent::MemberKey(m) | Parent::MemberInit(m) => class_of(m),
                Parent::ClassExtends(c) | Parent::ClassDecorator(c) => class(c),
                // "visits only the computed name of a method, an accessor or a constructor"
                Parent::MemberDecorator(m) => match f.members.get(m.idx()) {
                    Some(member) if member.func.is_none() => class_of(m),
                    _ => NOWHERE,
                },
                // Anything but the expression body is a parameter's decorator.
                Parent::FnBody(func) => match f.fns.get(func.idx()).map(|it| it.body) {
                    Some(FnBody::Expr(body)) if body == e => Next::Is(func),
                    _ => NOWHERE,
                },
                Parent::ParamDecorator(_)
                | Parent::EnumInit(_)
                | Parent::Module(_)
                | Parent::File
                | Parent::None => NOWHERE,
            },
            Ancestor::Stmt(s) => {
                match (f.stmts.get(s.idx()).map(|it| it.kind), b.parent_of_stmt(s)) {
                    (
                        None
                        | Some(
                            StmtKind::Enum(_)
                            | StmtKind::Interface(_)
                            | StmtKind::Module(_)
                            | StmtKind::TypeAlias(_)
                            | StmtKind::Fn(_),
                        ),
                        _,
                    ) => NOWHERE,
                    (_, Parent::Stmt(above)) => Next::At(Ancestor::Stmt(above)),
                    // "visits a static block like any statement"
                    (_, Parent::FnBody(func)) => match (
                        f.fns.get(func.idx()).map(|it| it.kind),
                        b.fns.get(func.idx()),
                    ) {
                        (
                            Some(FnKind::StaticBlock),
                            Some(FnInfo {
                                owner: FnOwner::Member(m),
                                ..
                            }),
                        ) => class_of(*m),
                        _ => Next::Is(func),
                    },
                    _ => NOWHERE,
                }
            }
            Ancestor::Pat(p) => match b.pat_parent.get(p.idx()) {
                Some(&(PatParent::Prop(above, _) | PatParent::Elem(above, _))) => {
                    Next::At(Ancestor::Pat(above))
                }
                Some(&PatParent::Var(d)) => statement(b.var_stmt.get(d.idx())),
                Some(&PatParent::Param(param)) => function(b.param_fn.get(param.idx())),
                Some(PatParent::None) | None => NOWHERE,
            },
        }
    }
}

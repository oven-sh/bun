//! What a linter without a checker is told of a file: what each node is part of, the kind of each
//! expression, and for each function what encloses it and where it returns and yields.
//!
//! All of it is read off the lists of the file, in which a node comes after its parts and the parts
//! are in source order. Nothing here calls itself, and nothing is declared or resolved.

use super::*;
use crate::util::SharedSort;

/// Makes `b` what [`bind_for_lint_in`] says. `false`: the file takes the binder.
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

/// Where the function that `owner` owns ends.
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

/// From where on what is written is in the function: after its decorators and its name, which can be
/// computed.
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

/// `FnInfo::enclosing` and `FnInfo::returns`. `b.ids` has the `return` statements of the file.
///
/// A function comes after the functions in it, so what is in its range and in no function so far is
/// directly in it. `false`: the lists are not in that order.
fn functions<S: Storage>(f: &FileIn<S>, b: &mut BoundBuilder) -> bool {
    let (fns, ids) = (&mut b.fns[..], &mut b.ids);
    // The functions that are in no function so far: the last, and each has the one before as its
    // `enclosing`.
    let mut open = FnId::NONE;
    // The same for the `return` statements: `ids[..pending]`. Those at `ids[read..found]` end later
    // than the functions so far.
    let (mut pending, mut read, found) = (0, 0, ids.len());
    // Where the last of them ends.
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

/// A node on the way up from a `yield`.
#[derive(Copy, Clone)]
enum Place {
    Expr(ExprId),
    Stmt(StmtId),
    Pat(PatId),
}

enum Next {
    At(Place),
    /// The function that has what is yielded below. `NONE`: none has.
    Is(FnId),
}

/// `FnInfo::yields`: what `forEachYieldExpression` finds.
struct Yields<'l, S: Storage> {
    f: &'l FileIn<S>,
    b: &'l mut BoundBuilder,
    /// For each node that a way up has passed, where it has led.
    of_expr: Vec<Option<FnId>>,
    of_stmt: Vec<Option<FnId>>,
    of_pat: Vec<Option<FnId>>,
}

impl<'l, S: Storage> Yields<'l, S> {
    fn new(f: &'l FileIn<S>, b: &'l mut BoundBuilder) -> Self {
        Yields {
            of_expr: vec![None; f.exprs.len()],
            of_stmt: vec![None; f.stmts.len()],
            of_pat: vec![None; f.pats.len()],
            f,
            b,
        }
    }

    fn list(&mut self) {
        let f = self.f;
        let mut found: Vec<(FnId, u32)> = Vec::new();
        let mut passed: Vec<Place> = Vec::new();
        for (i, e) in f.exprs.iter().enumerate() {
            if let ExprKind::Yield { .. } = e.kind {
                let function = self.function_of(ExprId(i as u32), &mut passed);
                if function.is_some() {
                    found.push((function, i as u32));
                }
            }
        }
        found.shared_sort_unstable_by_key(|it| (it.0.0, it.1));
        for of_one in found.chunk_by(|a, b| a.0 == b.0) {
            if let Some(info) = self.b.fns.get_mut(of_one[0].0.idx()) {
                info.yields = IdList::new(self.b.ids.len() as u32, of_one.len() as u32);
                self.b.ids.extend(of_one.iter().map(|it| it.1));
            }
        }
    }

    /// Every node is passed once: whoever gets to it again takes what was found.
    fn function_of(&mut self, e: ExprId, passed: &mut Vec<Place>) -> FnId {
        let mut at = Place::Expr(e);
        let function = loop {
            let known = match at {
                Place::Expr(it) => self.of_expr.get_mut(it.idx()),
                Place::Stmt(it) => self.of_stmt.get_mut(it.idx()),
                Place::Pat(it) => self.of_pat.get_mut(it.idx()),
            };
            match known {
                None => break FnId::NONE,
                Some(&mut Some(function)) => break function,
                // Until the way has ended.
                Some(unknown) => *unknown = Some(FnId::NONE),
            }
            passed.push(at);
            match self.above(at) {
                Next::At(above) => at = above,
                Next::Is(function) => break function,
            }
        };
        for place in passed.drain(..) {
            match place {
                Place::Expr(it) => self.of_expr[it.idx()] = Some(function),
                Place::Stmt(it) => self.of_stmt[it.idx()] = Some(function),
                Place::Pat(it) => self.of_pat[it.idx()] = Some(function),
            }
        }
        function
    }

    fn above(&self, at: Place) -> Next {
        const NOWHERE: Next = Next::Is(FnId::NONE);
        let (f, b) = (self.f, &*self.b);
        let statement = |s: Option<&StmtId>| s.map_or(NOWHERE, |&s| Next::At(Place::Stmt(s)));
        let function = |func: Option<&FnId>| func.map_or(NOWHERE, |&func| Next::Is(func));
        let class = |c: ClassId| match b.class_owner.get(c.idx()) {
            Some(&ClassOwner::Expr(e)) => Next::At(Place::Expr(e)),
            Some(&ClassOwner::Stmt(s)) => Next::At(Place::Stmt(s)),
            None => NOWHERE,
        };
        // It descends into no type.
        let class_of = |m: MemberId| match b.member_owner.get(m.idx()) {
            Some(&MemberOwner::Class(c)) => class(c),
            _ => NOWHERE,
        };
        match at {
            Place::Expr(e) => match b.expr_parent.get(e.idx()).copied().unwrap_or(Parent::None) {
                Parent::Expr(above) | Parent::PropKey(above, _) => Next::At(Place::Expr(above)),
                Parent::Stmt(s) => Next::At(Place::Stmt(s)),
                Parent::VarInit(d) => statement(b.var_stmt.get(d.idx())),
                Parent::Case(c) => statement(b.case_stmt.get(c.idx())),
                Parent::ParamDefault(p) => function(b.param_fn.get(p.idx())),
                Parent::PatPropDefault(p) | Parent::PatKey(p) => f
                    .pat_props
                    .get(p.idx())
                    .map_or(NOWHERE, |it| Next::At(Place::Pat(it.value))),
                Parent::PatElemDefault(p) => f
                    .pat_elems
                    .get(p.idx())
                    .map_or(NOWHERE, |it| Next::At(Place::Pat(it.pat))),
                Parent::Prop(p) | Parent::MethodKey(p) => b
                    .prop_owner
                    .get(p.idx())
                    .map_or(NOWHERE, |&it| Next::At(Place::Expr(it))),
                Parent::MemberKey(m) | Parent::MemberInit(m) => class_of(m),
                Parent::ClassExtends(c) | Parent::Decorator(c, DecoratorOwner::Class(_)) => {
                    class(c)
                }
                // "visits only the computed name of a method, an accessor or a constructor"
                Parent::Decorator(c, DecoratorOwner::Member(m)) => match f.members.get(m.idx()) {
                    Some(member) if member.func.is_none() => class(c),
                    _ => NOWHERE,
                },
                // Any other is a decorator of a parameter.
                Parent::FnBody(func) => match f.fns.get(func.idx()).map(|it| it.body) {
                    Some(FnBody::Expr(body)) if body == e => Next::Is(func),
                    _ => NOWHERE,
                },
                Parent::Decorator(_, DecoratorOwner::Param(_))
                | Parent::EnumInit(_)
                | Parent::Module(_)
                | Parent::File
                | Parent::None => NOWHERE,
            },
            Place::Stmt(s) => match (
                f.stmts.get(s.idx()).map(|it| it.kind),
                b.stmt_parent.get(s.idx()),
            ) {
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
                (_, Some(&Parent::Stmt(above))) => Next::At(Place::Stmt(above)),
                // "visits a static block like any statement"
                (_, Some(&Parent::FnBody(func))) => match (
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
            },
            Place::Pat(p) => match b.pat_parent.get(p.idx()) {
                Some(&(PatParent::Prop(above, _) | PatParent::Elem(above, _))) => {
                    Next::At(Place::Pat(above))
                }
                Some(&PatParent::Var(d)) => statement(b.var_stmt.get(d.idx())),
                Some(&PatParent::Param(param)) => function(b.param_fn.get(param.idx())),
                Some(PatParent::None) | None => NOWHERE,
            },
        }
    }
}

use crate::bind::{Binding, Bound, Decl, FnOwner, Parent, SymbolId};
use crate::hir::{
    BinOp, Chain, ExprId, ExprKind, File, Flags, FnBody, FnId, IdList, StmtId, StmtKind,
};
use crate::util::FxHashMap;
use std::cell::{OnceCell, RefCell};

/// The code of a file that runs whenever the file runs.
pub(super) struct CertainCode<'a, 's> {
    hir: &'a File<'s>,
    bound: &'a Bound<'s>,
    calls: OnceCell<FxHashMap<SymbolId, Vec<ExprId>>>,
    places: RefCell<FxHashMap<FnId, Option<u32>>>,
    first_exits: RefCell<FxHashMap<FnId, u32>>,
}

impl<'a, 's> CertainCode<'a, 's> {
    pub(super) fn new(hir: &'a File<'s>, bound: &'a Bound<'s>) -> Self {
        CertainCode {
            hir,
            bound,
            calls: OnceCell::new(),
            places: RefCell::default(),
            first_exits: RefCell::default(),
        }
    }

    /// Returns the position of the file's own statement that runs `expression`, if the expression runs whenever the file does.
    pub(super) fn place_of(&self, expression: ExprId) -> Option<u32> {
        let mut inner = expression;
        loop {
            let statement = match self.bound.parent_of_expr(inner) {
                Parent::Expr(outer) if self.always_evaluates(outer, inner) => {
                    inner = outer;
                    continue;
                }
                Parent::Prop(property) => {
                    inner = self.bound.prop_owner[property.idx()];
                    continue;
                }
                Parent::Stmt(statement) => statement,
                Parent::VarInit(declaration) => self.bound.var_stmt[declaration.idx()],
                Parent::FnBody(function) => {
                    return self.place_in_function(function, self.hir[inner].pos);
                }
                _ => return None,
            };
            return match self.hir[statement].kind {
                StmtKind::Expr(_)
                | StmtKind::Var(_)
                | StmtKind::Return(_)
                | StmtKind::Throw(_)
                | StmtKind::If { .. }
                | StmtKind::Switch { .. } => self.place_of_statement(statement),
                _ => None,
            };
        }
    }

    fn always_evaluates(&self, outer: ExprId, inner: ExprId) -> bool {
        match self.hir[outer].kind {
            ExprKind::Cond { test, .. } => test == inner,
            ExprKind::Binary {
                op: BinOp::And | BinOp::Or | BinOp::Nullish,
                left,
                ..
            } => left == inner,
            ExprKind::Assign {
                op: Some(BinOp::And | BinOp::Or | BinOp::Nullish),
                target,
                ..
            } => target == inner,
            ExprKind::Index { obj, chain, .. } => chain == Chain::No || obj == inner,
            ExprKind::Call(call) => {
                let call = &self.hir[call];
                call.chain == Chain::No || call.callee == inner
            }
            ExprKind::Fn(_) | ExprKind::Class(_) | ExprKind::Yield { .. } => false,
            _ => true,
        }
    }

    fn place_of_statement(&self, mut statement: StmtId) -> Option<u32> {
        let written_at = self.hir[statement].start;
        loop {
            let outer = match self.bound.parent_of_stmt(statement) {
                Parent::File => return Some(self.hir[statement].start),
                Parent::FnBody(function) => return self.place_in_function(function, written_at),
                Parent::Stmt(outer) => outer,
                _ => return None,
            };
            let runs_inner = match self.hir[outer].kind {
                StmtKind::Block(_) => true,
                StmtKind::Try { block, .. } => block == statement,
                _ => false,
            };
            if !runs_inner {
                return None;
            }
            statement = outer;
        }
    }

    fn place_in_function(&self, function: FnId, position: u32) -> Option<u32> {
        let flags = self.hir[function].flags;
        if flags.intersects(Flags::ASYNC | Flags::GENERATOR) || position > self.first_exit(function)
        {
            return None;
        }
        if let Some(&place) = self.places.borrow().get(&function) {
            return place;
        }
        self.places.borrow_mut().insert(function, None);
        let place = self.place_of_first_call(function);
        self.places.borrow_mut().insert(function, place);
        place
    }

    /// The position behind which a call of the function may have ended.
    fn first_exit(&self, function: FnId) -> u32 {
        let FnBody::Block(statements) = self.hir[function].body else {
            return u32::MAX;
        };
        let mut first_exits = self.first_exits.borrow_mut();
        *first_exits
            .entry(function)
            .or_insert_with(|| self.first_exit_in(statements).unwrap_or(u32::MAX))
    }

    fn first_exit_in(&self, statements: IdList<StmtId>) -> Option<u32> {
        self.hir.ids(statements).find_map(|statement: StmtId| {
            let written = &self.hir[statement];
            match written.kind {
                StmtKind::Empty
                | StmtKind::Debugger
                | StmtKind::Expr(_)
                | StmtKind::Var(_)
                | StmtKind::Fn(_)
                | StmtKind::Class(_)
                | StmtKind::Interface(_)
                | StmtKind::TypeAlias(_)
                | StmtKind::Enum(_) => None,
                StmtKind::Block(inner) => self.first_exit_in(inner),
                StmtKind::Try { block, .. } => match self.hir[block].kind {
                    StmtKind::Block(inner) => {
                        Some(self.first_exit_in(inner).unwrap_or(written.loc.end))
                    }
                    _ => Some(written.start),
                },
                _ => Some(written.start),
            }
        })
    }

    fn place_of_first_call(&self, function: FnId) -> Option<u32> {
        let (hir, bound) = (self.hir, self.bound);
        let symbol = match bound.fns[function.idx()].owner {
            FnOwner::Stmt(_) => bound.declared_symbol(Decl::Fn(function)),
            FnOwner::Expr(written) => match bound.parent_of_expr(written) {
                Parent::Expr(outer) => {
                    let is_called = matches!(hir[outer].kind, ExprKind::Call(call) if hir[call].callee == written);
                    return is_called.then(|| self.place_of(outer)).flatten();
                }
                Parent::VarInit(declaration) => {
                    match bound.initialized_binding(hir[declaration].pat) {
                        Binding::Symbol(symbol) => symbol,
                        _ => return None,
                    }
                }
                _ => return None,
            },
            _ => return None,
        };
        if !bound.is_stable_binding(symbol) {
            return None;
        }
        let calls = self.calls.get_or_init(|| self.list_calls());
        let calls = calls.get(&symbol)?.iter();
        calls.filter_map(|&call| self.place_of(call)).min()
    }

    fn list_calls(&self) -> FxHashMap<SymbolId, Vec<ExprId>> {
        let mut calls: FxHashMap<SymbolId, Vec<ExprId>> = FxHashMap::default();
        for expression in (0..self.hir.exprs.len() as u32).map(ExprId) {
            if let ExprKind::Call(call) = self.hir[expression].kind
                && let callee = self.hir[call].callee
                && matches!(self.hir[callee].kind, ExprKind::Ident(_))
                && let Binding::Symbol(symbol) = self.bound.binding(callee)
            {
                calls.entry(symbol).or_default().push(expression);
            }
        }
        calls
    }
}

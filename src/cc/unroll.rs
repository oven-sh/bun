//! Unrolls `for` loops that count through a few constants and use the counter to index a
//! local array: `for (i = 0; i < 16; ++i) out[i] = x[i] + in[i];` becomes sixteen
//! statements with `i` replaced by its value. That is what lets `x` be replaced by its
//! elements afterwards (see `codegen_sroa`): an array indexed by a variable has to stay
//! in memory.
//!
//! The counter must be a local integer nobody else can change: only the loop's own step
//! assigns it and its address is never taken. The body may not contain anything that
//! would mean something else once copied (labels, `switch`, `break`, `continue`,
//! declarations of variable length arrays).

use crate::ast::*;
use crate::constexpr::{self, Const};
use crate::types::{Type, TypeCtx};

const MAX_TRIPS: usize = 16;
/// Expression nodes in all the copies together.
const MAX_NODES: usize = 4096;
/// Statements in all the copies together.
const MAX_STATEMENTS: usize = 256;

struct Unroller<'a> {
    tcx: &'a TypeCtx,
    locals: &'a [LocalVar],
    /// When set: only a loop that indexes one of these locals (by id) is unrolled.
    worth_it: Option<&'a [bool]>,
}

fn literal(value: i64, ty: &Type, loc: crate::token::Loc) -> Expr {
    Expr {
        kind: ExprKind::IntLit(value),
        ty: ty.clone(),
        loc,
        has_control_flow: false,
        depth: 1,
    }
}

/// `e` with every read of `counter` replaced by `value`.
fn substitute(e: &mut Expr, counter: LocalId, value: i64) {
    if matches!(e.kind, ExprKind::Local(id) if id == counter) {
        *e = literal(value, e.ty.unqualified(), e.loc);
        return;
    }
    if let ExprKind::StmtExpr { stmts, .. } = &mut e.kind {
        for s in stmts {
            substitute_stmt(s, counter, value);
        }
    }
    e.for_each_child_mut(|c| substitute(c, counter, value));
}

fn substitute_items(items: &mut [InitItem], counter: LocalId, value: i64) {
    for item in items {
        match item {
            InitItem::Scalar { expr, .. }
            | InitItem::Copy { expr, .. }
            | InitItem::Bits { expr, .. } => {
                substitute(expr, counter, value);
            }
            InitItem::Bytes { .. } => {}
        }
    }
}

fn substitute_stmt(s: &mut Stmt, counter: LocalId, value: i64) {
    match s {
        Stmt::Empty | Stmt::Goto(_) | Stmt::Break | Stmt::Continue | Stmt::Return(None) => {}
        Stmt::Expr(e) | Stmt::Return(Some(e)) | Stmt::GotoComputed(e) => {
            substitute(e, counter, value)
        }
        Stmt::LocalInit { items, .. } => substitute_items(items, counter, value),
        Stmt::Block(stmts) => stmts
            .iter_mut()
            .for_each(|s| substitute_stmt(s, counter, value)),
        Stmt::If(c, then, other) => {
            substitute(c, counter, value);
            substitute_stmt(then, counter, value);
            if let Some(other) = other {
                substitute_stmt(other, counter, value);
            }
        }
        Stmt::While(c, body) | Stmt::DoWhile(body, c) => {
            substitute(c, counter, value);
            substitute_stmt(body, counter, value);
        }
        Stmt::For {
            init,
            cond,
            step,
            body,
        } => {
            if let Some(init) = init {
                substitute_stmt(init, counter, value);
            }
            if let Some(cond) = cond {
                substitute(cond, counter, value);
            }
            if let Some(step) = step {
                substitute(step, counter, value);
            }
            substitute_stmt(body, counter, value);
        }
        Stmt::Switch { cond, body, .. } => {
            substitute(cond, counter, value);
            substitute_stmt(body, counter, value);
        }
        Stmt::Label(_, body) => substitute_stmt(body, counter, value),
        Stmt::VlaAlloc { size, .. } => substitute(size, counter, value),
        Stmt::VlaScope { cleanup, body, .. } => {
            if let Some(cleanup) = cleanup {
                substitute(cleanup, counter, value);
            }
            body.iter_mut()
                .for_each(|s| substitute_stmt(s, counter, value));
        }
    }
}

/// What a loop body may not contain, and what it must: see the module's description.
#[derive(Default)]
struct BodyFacts {
    nodes: usize,
    statements: usize,
    unsuitable: bool,
    /// The local aggregates the body indexes with the counter.
    indexed: Vec<LocalId>,
}

impl Unroller<'_> {
    fn is_counter_read(e: &Expr, counter: LocalId) -> bool {
        let mut e = e;
        while let ExprKind::Cast(inner) = &e.kind {
            if !e.ty.is_integer() || !inner.ty.is_integer() {
                return false;
            }
            e = inner;
        }
        matches!(e.kind, ExprKind::Local(id) if id == counter)
    }

    fn mentions(e: &Expr, counter: LocalId) -> bool {
        let mut found = matches!(e.kind, ExprKind::Local(id) if id == counter);
        e.for_each_child(|c| found |= Self::mentions(c, counter));
        found
    }

    fn examine_expr(&self, e: &Expr, counter: LocalId, facts: &mut BodyFacts) {
        facts.nodes += 1;
        match &e.kind {
            ExprKind::Assign(lhs, _)
            | ExprKind::CompoundAssign { lhs, .. }
            | ExprKind::IncDec { lhs, .. }
                if matches!(lhs.kind, ExprKind::Local(id) if id == counter) =>
            {
                facts.unsuitable = true;
            }
            ExprKind::StmtExpr { stmts, .. } => {
                for s in stmts {
                    self.examine_stmt(s, counter, facts);
                }
            }
            ExprKind::CompoundLiteral { .. } => facts.unsuitable = true,
            // `array[... counter ...]` for a local array (or an array inside a local).
            ExprKind::PtrAdd { ptr, index, .. } if Self::mentions(index, counter) => {
                let mut base: &Expr = ptr;
                while let ExprKind::Decay(inner) | ExprKind::Member(inner, _) = &base.kind {
                    base = inner;
                }
                if let ExprKind::Local(id) = base.kind {
                    let aggregate = self.locals.get(id as usize).is_some_and(|l| {
                        matches!(l.ty.unqualified(), Type::Array(..) | Type::Struct(_))
                    });
                    if aggregate && !facts.indexed.contains(&id) {
                        facts.indexed.push(id);
                    }
                }
            }
            _ => {}
        }
        e.for_each_child(|c| self.examine_expr(c, counter, facts));
    }

    fn examine_stmt(&self, s: &Stmt, counter: LocalId, facts: &mut BodyFacts) {
        facts.statements += 1;
        match s {
            Stmt::Empty | Stmt::Goto(_) | Stmt::Return(None) => {}
            Stmt::Break
            | Stmt::Continue
            | Stmt::Label(..)
            | Stmt::Switch { .. }
            | Stmt::VlaAlloc { .. }
            | Stmt::VlaScope { .. }
            | Stmt::GotoComputed(_) => facts.unsuitable = true,
            Stmt::Expr(e) | Stmt::Return(Some(e)) => self.examine_expr(e, counter, facts),
            Stmt::LocalInit { items, .. } => {
                for item in items {
                    match item {
                        InitItem::Scalar { expr, .. }
                        | InitItem::Copy { expr, .. }
                        | InitItem::Bits { expr, .. } => self.examine_expr(expr, counter, facts),
                        InitItem::Bytes { .. } => {}
                    }
                }
            }
            Stmt::Block(stmts) => stmts
                .iter()
                .for_each(|s| self.examine_stmt(s, counter, facts)),
            Stmt::If(c, then, other) => {
                self.examine_expr(c, counter, facts);
                self.examine_stmt(then, counter, facts);
                if let Some(other) = other {
                    self.examine_stmt(other, counter, facts);
                }
            }
            // `do { ... } while (0)`, the way macros wrap statements, is just a block.
            Stmt::DoWhile(body, c) if matches!(constexpr::eval(c, self.tcx), Ok(Const::Int(0))) => {
                self.examine_stmt(body, counter, facts);
            }
            // Inner loops keep their own `break` and `continue`; not worth the care.
            Stmt::While(..) | Stmt::DoWhile(..) | Stmt::For { .. } => facts.unsuitable = true,
        }
    }

    /// `counter = constant` as the loop's first clause.
    fn start_of(&self, init: &Stmt) -> Option<(LocalId, i64)> {
        let constant = |e: &Expr| match constexpr::eval(e, self.tcx) {
            Ok(Const::Int(v)) => Some(v),
            _ => None,
        };
        match init {
            Stmt::Expr(e) => {
                let mut e = e;
                if let ExprKind::Cast(inner) = &e.kind {
                    if e.ty.is_void() {
                        e = inner;
                    }
                }
                let ExprKind::Assign(lhs, rhs) = &e.kind else {
                    return None;
                };
                let ExprKind::Local(id) = lhs.kind else {
                    return None;
                };
                Some((id, constant(rhs)?))
            }
            Stmt::Block(stmts) => match stmts.as_slice() {
                [
                    Stmt::LocalInit {
                        local,
                        zero_first: false,
                        items,
                    },
                ] => match items.as_slice() {
                    [InitItem::Scalar { offset: 0, expr }] => Some((*local, constant(expr)?)),
                    _ => None,
                },
                _ => None,
            },
            _ => None,
        }
    }

    /// The counter's next value, if `step` is `counter++`, `counter += constant` or
    /// `counter = expression of counter`.
    fn next_value(&self, step: &Expr, counter: LocalId, now: i64, ty: &Type) -> Option<i64> {
        let mut step = step;
        if let ExprKind::Cast(inner) = &step.kind {
            if step.ty.is_void() {
                step = inner;
            }
        }
        let is_counter = |e: &Expr| matches!(e.kind, ExprKind::Local(id) if id == counter);
        let raw = match &step.kind {
            ExprKind::IncDec {
                lhs,
                inc,
                scale,
                dynamic_scale: None,
                ..
            } if is_counter(lhs) => {
                let by = i64::try_from(*scale).ok()?;
                if *inc {
                    now.wrapping_add(by)
                } else {
                    now.wrapping_sub(by)
                }
            }
            ExprKind::CompoundAssign {
                lhs,
                rhs,
                op: CompoundOp::Arith(op @ (BinOp::Add | BinOp::Sub)),
                ..
            } if is_counter(lhs) => {
                let Ok(Const::Int(by)) = constexpr::eval(rhs, self.tcx) else {
                    return None;
                };
                if *op == BinOp::Add {
                    now.wrapping_add(by)
                } else {
                    now.wrapping_sub(by)
                }
            }
            ExprKind::Assign(lhs, rhs) if is_counter(lhs) => {
                let mut rhs = (**rhs).clone();
                substitute(&mut rhs, counter, now);
                match constexpr::eval(&rhs, self.tcx) {
                    Ok(Const::Int(v)) => v,
                    _ => return None,
                }
            }
            _ => return None,
        };
        Some(constexpr::wrap(raw, ty, self.tcx))
    }

    /// The statements that replace `for (init; cond; step) body`, if it is unrolled.
    fn unrolled(&self, init: &Stmt, cond: &Expr, step: &Expr, body: &Stmt) -> Option<Vec<Stmt>> {
        let (counter, start) = self.start_of(init)?;
        let variable = self.locals.get(counter as usize)?;
        let ty = variable.ty.unqualified().clone();
        if !ty.is_integer() || ty.is_int128() || variable.addr_taken || variable.volatile {
            return None;
        }
        // The test looks at the counter and at constants only.
        let ExprKind::Binary(op, a, b) = &cond.kind else {
            return None;
        };
        let compares_counter = op.is_compare()
            && ((Self::is_counter_read(a, counter) && constexpr::eval(b, self.tcx).is_ok())
                || (Self::is_counter_read(b, counter) && constexpr::eval(a, self.tcx).is_ok()));
        if !compares_counter {
            return None;
        }
        let mut facts = BodyFacts::default();
        self.examine_stmt(body, counter, &mut facts);
        let pays = match self.worth_it {
            None => !facts.indexed.is_empty(),
            Some(replaceable) => facts
                .indexed
                .iter()
                .any(|id| replaceable.get(*id as usize).copied().unwrap_or(false)),
        };
        if facts.unsuitable || !pays {
            return None;
        }
        let mut out = vec![init.clone()];
        let mut value = constexpr::wrap(start, &ty, self.tcx);
        let mut trips = 0;
        loop {
            let mut test = cond.clone();
            substitute(&mut test, counter, value);
            match constexpr::eval(&test, self.tcx) {
                Ok(Const::Int(0)) => break,
                Ok(Const::Int(_)) => {}
                _ => return None,
            }
            trips += 1;
            if trips > MAX_TRIPS
                || trips * facts.nodes > MAX_NODES
                || trips * facts.statements > MAX_STATEMENTS
            {
                return None;
            }
            let mut copy = body.clone();
            substitute_stmt(&mut copy, counter, value);
            out.push(copy);
            value = self.next_value(step, counter, value, &ty)?;
        }
        // The counter ends up with the value that failed the test.
        let loc = cond.loc;
        let target = Expr {
            kind: ExprKind::Local(counter),
            ty: variable.ty.clone(),
            loc,
            has_control_flow: false,
            depth: 1,
        };
        out.push(Stmt::Expr(Expr {
            kind: ExprKind::Assign(Box::new(target), Box::new(literal(value, &ty, loc))),
            ty,
            loc,
            has_control_flow: false,
            depth: 2,
        }));
        Some(out)
    }

    /// Returns whether anything was unrolled.
    fn stmt(&self, s: &mut Stmt) -> bool {
        match s {
            Stmt::For {
                init: Some(init),
                cond: Some(cond),
                step: Some(step),
                body,
            } => {
                let mut changed = self.stmt(body);
                if let Some(replacement) = self.unrolled(init, cond, step, body) {
                    *s = Stmt::Block(replacement);
                    changed = true;
                }
                changed
            }
            Stmt::Block(stmts) | Stmt::VlaScope { body: stmts, .. } => {
                let mut changed = false;
                for s in stmts {
                    changed |= self.stmt(s);
                }
                changed
            }
            Stmt::If(_, then, other) => {
                let mut changed = self.stmt(then);
                if let Some(other) = other {
                    changed |= self.stmt(other);
                }
                changed
            }
            Stmt::While(_, body)
            | Stmt::DoWhile(body, _)
            | Stmt::For { body, .. }
            | Stmt::Switch { body, .. }
            | Stmt::Label(_, body) => self.stmt(body),
            _ => false,
        }
    }
}

/// Unrolls the loops of a function body whose unrolling is what lets a local aggregate be
/// replaced by its elements: first every candidate loop in a copy of the body, to see
/// which aggregates would then qualify; then, in the body itself, only the loops that
/// index one of those. A loop over an array that has to stay in memory anyway (another
/// loop indexes it with a variable, its address escapes) is left as it is.
pub(crate) fn unroll_counted_loops(body: &mut FuncBody, tcx: &TypeCtx) {
    let mut trial = FuncBody {
        params: body.params.clone(),
        locals: Vec::new(),
        stmts: body.stmts.clone(),
        nlabels: body.nlabels,
        address_labels: Vec::new(),
        label_vla_paths: Vec::new(),
    };
    std::mem::swap(&mut trial.locals, &mut body.locals);
    let everything = Unroller {
        tcx,
        locals: &trial.locals,
        worth_it: None,
    };
    let mut changed = false;
    let mut stmts = std::mem::take(&mut trial.stmts);
    for s in &mut stmts {
        changed |= everything.stmt(s);
    }
    trial.stmts = stmts;
    let replaceable = if changed {
        crate::codegen::replaceable_aggregates(&trial, tcx)
    } else {
        Vec::new()
    };
    std::mem::swap(&mut trial.locals, &mut body.locals);
    if !replaceable.contains(&true) {
        return;
    }
    let chosen = Unroller {
        tcx,
        locals: &body.locals,
        worth_it: Some(&replaceable),
    };
    let mut stmts = std::mem::take(&mut body.stmts);
    for s in &mut stmts {
        chosen.stmt(s);
    }
    body.stmts = stmts;
}

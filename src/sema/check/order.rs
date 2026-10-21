//! The order in which queries are made.
//!
//! Types are computed on demand, and some results depend on earlier queries. For example, a call determines its
//! arguments' contextual types. TypeScript checks a file top-down and defers the bodies of function expressions
//! (`checkNodeDeferred`), so the call that a function is an argument of is always resolved before anything in
//! the function is checked. Here any caller may make any query first. So a top-level query starts by resolving
//! the calls that enclose its subject, outermost first, which makes the result independent of the caller.

use super::root_declaration;
use super::{Checker, Query};
use crate::bind::{Parent, PatParent};
use crate::hir::{ExprId, FnId, PatId};
use crate::program::FileId;

impl Checker<'_, '_> {
    /// True if no query is in progress, so the current query is a top-level query.
    #[inline]
    pub(super) fn is_top_level_query(&self) -> bool {
        self.stack.is_empty() && self.contextual.is_empty()
    }

    #[inline]
    /// Returns true if anything may have been computed.
    pub(super) fn prepare_query_for_expr(&mut self, file: FileId, e: ExprId) -> bool {
        // If the expression is rejected, so are the calls around it.
        if !self.is_top_level_query() || e.is_none() || self.is_rejected(Query::Expr(file, e)) {
            return false;
        }
        // Every computation starts with a query, and every query increments `work`.
        let requested = self.work;
        self.prepare_enclosing(file, e);
        self.work != requested
    }

    #[inline]
    pub(super) fn prepare_query_for_fn(&mut self, file: FileId, func: FnId) -> bool {
        let is_from_outside = self.is_top_level_query();
        if is_from_outside {
            self.prepare_fn(file, func);
        }
        is_from_outside
    }

    #[inline]
    pub(super) fn prepare_query_for_pat(&mut self, file: FileId, pat: PatId) -> bool {
        if !self.is_top_level_query() {
            return false;
        }
        let bound = self.bound(file);
        let root = root_declaration(bound, pat);
        match root {
            PatParent::Param(p) => self.prepare_fn(file, bound.param_fn[p.idx()]),
            PatParent::Var(d) => {
                let stmt = bound.var_stmt[d.idx()];
                if stmt.is_some() {
                    self.prepare_parent(file, Parent::Stmt(stmt));
                }
            }
            _ => {}
        }
        true
    }
}

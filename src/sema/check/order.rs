//! The order in which queries are made.
//!
//! Types are computed on demand, and some results depend on earlier queries: a call determines the
//! contextual types of its arguments. TypeScript checks a file from the top down and defers the
//! bodies of function expressions (`checkNodeDeferred`), so the call a function is an argument of
//! is always resolved before anything in the function is checked. Here any caller may make any
//! query first. So a top-level query starts by resolving the calls that enclose its subject,
//! outermost first, and the result does not depend on the caller.

use super::Checker;
use super::root_declaration;
use crate::bind::{Parent, PatParent};
use crate::hir::{ExprId, FnId, PatId};
use crate::program::FileId;

impl Checker<'_, '_> {
    /// Whether no query is in progress: the current query is a top-level query.
    #[inline]
    pub(super) fn is_top_level_query(&self) -> bool {
        self.stack.is_empty() && self.contextual.is_empty()
    }

    #[inline]
    /// Returns whether anything may have been computed.
    pub(super) fn prepare_query_for_expr(&mut self, file: FileId, e: ExprId) -> bool {
        if !self.is_top_level_query() || e.is_none() {
            return false;
        }
        // Nothing is computed without a query being made.
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

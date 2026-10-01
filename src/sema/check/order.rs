//! The order questions are asked in.
//!
//! Types are worked out when they are asked for, and some answers depend on what has been asked before: a call settles what is
//! expected of its arguments. TypeScript checks a file from the top down and puts off the bodies of function expressions
//! (`checkNodeDeferred`), so the call a function is an argument of is always resolved before anything in the function is looked at.
//! Here anybody may ask anything first. So a question that nothing led to starts by resolving the calls around what it is about,
//! outermost first, and the answer does not depend on who asked.

use super::Checker;
use crate::bind::{Parent, PatParent};
use crate::hir::{ExprId, FnId, PatId};
use crate::program::FileId;

impl Checker<'_> {
    /// Whether nothing is being worked out: what is asked now is asked from outside.
    #[inline]
    fn is_asked_from_outside(&self) -> bool {
        self.stack.is_empty() && self.resolving.is_empty()
    }

    #[inline]
    /// Whether anything may have been worked out.
    pub(super) fn prepare_question_about_expr(&mut self, file: FileId, e: ExprId) -> bool {
        let is_from_outside = self.is_asked_from_outside() && e.is_some();
        if is_from_outside {
            self.prepare_enclosing(file, e);
        }
        is_from_outside
    }

    #[inline]
    pub(super) fn prepare_question_about_fn(&mut self, file: FileId, func: FnId) -> bool {
        let is_from_outside = self.is_asked_from_outside();
        if is_from_outside {
            self.prepare_fn(file, func);
        }
        is_from_outside
    }

    #[inline]
    pub(super) fn prepare_question_about_pat(&mut self, file: FileId, pat: PatId) -> bool {
        if !self.is_asked_from_outside() {
            return false;
        }
        let bound = self.bound(file);
        let mut root = bound.pat_parent[pat.idx()];
        while let PatParent::Prop(outer, _) | PatParent::Elem(outer, _) = root {
            root = bound.pat_parent[outer.idx()];
        }
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

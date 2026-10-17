//! The order in which queries are made.
//!
//! Types are computed on demand, and some results depend on earlier queries: a call determines the
//! contextual types of its arguments. TypeScript checks a file from the top down and defers the
//! bodies of function expressions (`checkNodeDeferred`), so the call a function is an argument of
//! is always resolved before anything in the function is checked. Here any caller may make any
//! query first. So a top-level query starts by resolving the calls that enclose its subject,
//! outermost first, and the result does not depend on the caller.
//!
//! With one exception, which TypeScript has too:
//!
//! ```ts
//! function start() {
//!   const server = serve({ fetch: () => server.port });
//!   return server;
//! }
//! ```
//!
//! `getResolvedSignature` hides the resolutions in progress while it resolves `serve(..)`. So the `server` in the argument
//! starts a second resolution of `server`, which finds the circle and stores `any`. The first one goes on and ends with
//! what `serve` returns. `getTypeOfVariableOrParameterOrProperty` keeps the `any` for everybody who asks later, but hands
//! its own result to the caller that started it. If that caller is the check of the declaration, nothing comes of it, and
//! `start()` is `any`. If it is the return type of `start`, because somebody asked for `start()` first, that is what
//! `serve` returns, for good.
//!
//! Who comes first in TypeScript is only known by checking the file as TypeScript does. Nothing in the syntax tells such a
//! variable from the many whose callback mentions them and closes no circle, and the way back can lead through other
//! declarations. So it's found out when it happens (`note_order_dependence`), and whoever asks for types without
//! checking the file first drops what the task has computed and starts the task again with that file checked in full:
//! `take_files_that_depend_on_order`, `check_in_full`.

use super::root_declaration;
use super::symbols::is_variable_or_property;
use super::{Checker, Query, Requested};
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
        // The calls around what is refused are refused.
        if !self.is_top_level_query() || e.is_none() || self.is_refused(Query::Expr(file, e)) {
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

    /// Whether `check_file` has to check `file` in full before anybody asks for a type in it, because the answers depend on
    /// what was asked before.
    pub(super) fn depends_on_order(&self, file: FileId) -> bool {
        self.bound(file).has_types_that_depend_on_order() || self.checked_in_full.contains(&file)
    }

    /// Before the first `check_file`: what `take_files_that_depend_on_order` returned to the tasks that this one replaces.
    pub fn check_in_full(&mut self, files: &[FileId]) {
        self.checked_in_full = files.to_vec();
    }

    /// The files in which a type has turned out to depend on who asks first, and that this checker doesn't check in full.
    /// If there is one that TypeScript would have checked by now, nothing that the task has computed since counts.
    pub fn take_files_that_depend_on_order(&mut self) -> Vec<FileId> {
        std::mem::take(&mut self.found_to_depend_on_order)
    }

    /// Checks `file` in full and reports nothing. It's one of `check_in_full` that the task doesn't visit itself, and
    /// comes before the files that it does visit.
    pub fn check_for_the_files_after(&mut self, file: FileId) {
        let _ = self.check_file(file);
        if !self.reports_semantic_errors(file) {
            self.check_source_file_and_report_nothing(file);
        }
    }

    /// The first caller of `getTypeOfVariableOrParameterOrProperty` gets, or would have got, another type than the next for
    /// something that `file` declares.
    #[cold]
    pub(super) fn note_order_dependence(&mut self, file: FileId) {
        let is_checked_anyway = match self.expected {
            Requested::All => self.reports_semantic_errors(file),
            Requested::Types => false,
            Requested::Syntactic | Requested::Declaration => return,
        };
        // Another task may check it in full, but nothing of that is published, or this would not have been computed here.
        let is_visited_now = self.task.file == Some(file);
        if !(is_visited_now && (is_checked_anyway || self.depends_on_order(file)))
            && !self.checked_in_full.contains(&file)
            && !self.found_to_depend_on_order.contains(&file)
        {
            self.found_to_depend_on_order.push(file);
        }
    }

    /// `note_order_dependence`, if `q`, which has just become circular, is such a resolution.
    #[cold]
    pub(super) fn note_circular_resolution(&mut self, q: Query) {
        let file = match q {
            Query::Pat(file, _) | Query::ParameterSymbol(file, _) => Some(file),
            Query::Symbol(sym) => {
                let declaration = self.files().value_declaration(sym);
                let is_one = is_variable_or_property(self.files().flags(sym), declaration);
                declaration.filter(|_| is_one).map(|it| it.0)
            }
            _ => None,
        };
        if let Some(file) = file {
            self.note_order_dependence(file);
        }
    }
}

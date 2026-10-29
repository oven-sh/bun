use crate::check::explain::NOWHERE;
use crate::check::sink::Reported;
use crate::check::{Checker, Query};
use crate::program::FileId;

impl Checker<'_, '_> {
    pub(in crate::check) fn locate_global_diagnostic(
        &self,
        owner: Option<Query>,
        diagnostic: &mut Reported,
    ) {
        if diagnostic.file != NOWHERE.0 || !self.files.is_compile_build() {
            return;
        }
        let mut queries = owner.into_iter().chain(self.stack.iter().rev().copied());
        let location = queries
            .find_map(|query| self.query_location(query))
            .or_else(|| {
                let current = self.current_node().or(self.current_source_element)?;
                Some(self.span_of_current_node(current))
            });
        if let Some((file, start, end)) = location {
            (diagnostic.file, diagnostic.start, diagnostic.end) = (file, start, end);
        }
    }

    fn query_location(&self, query: Query) -> Option<(FileId, u32, u32)> {
        match query {
            Query::Expr(file, e) | Query::ExprInFlowLoop(file, e) | Query::Call(file, e) => {
                Some((file, self.start_of(file, e), self.end_of_expr(file, e)))
            }
            Query::Return(file, function) | Query::ReturnAtFirstLook(file, function) => {
                Some((file, self.hir(file)[function].start, 0))
            }
            Query::Pat(file, pattern) | Query::ParameterSymbol(file, pattern) => {
                Some((file, self.hir(file)[pattern].pos, 0))
            }
            Query::Symbol(symbol)
            | Query::Declared(symbol)
            | Query::Bases(symbol)
            | Query::BaseConstructor(symbol) => {
                let (file, declaration) = *self.files().decls_of(symbol).first()?;
                let hir = self.hir(file);
                Some((file, hir.start(hir.node(declaration)), 0))
            }
            _ => None,
        }
    }
}

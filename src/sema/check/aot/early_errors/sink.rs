use crate::check::Checker;
use crate::check::aot::DiagnosticClass;
use crate::check::errors_type_nodes::has_parse_diagnostics;
use crate::check::sink::{Arg, Reported};
use crate::check::spans::{skip_trivia, start_of_token_before};
use crate::node::ToNode;
use crate::program::FileId;

impl Checker<'_, '_> {
    #[cold]
    pub(in crate::check) fn early_error_at(
        &mut self,
        at: (FileId, u32, u32),
        code: u32,
        args: &[Arg<'_>],
    ) -> &mut Reported {
        self.error_with_class(at, code, args, DiagnosticClass::EarlyError)
    }

    pub(in crate::check) fn early_grammar_error_at(
        &mut self,
        at: (FileId, u32, u32),
        code: u32,
        args: &[Arg<'_>],
    ) -> bool {
        if has_parse_diagnostics(self.hir(at.0)) {
            return false;
        }
        self.early_error_at(at, code, args);
        true
    }

    #[cold]
    pub(in crate::check) fn early_error_on_node(
        &mut self,
        file: FileId,
        node: impl ToNode,
        code: u32,
        args: &[Arg<'_>],
    ) -> &mut Reported {
        let class = self.early_error_class(file, self.hir(file).node(node));
        let reported = self.error(file, node, code, args);
        reported.class = class;
        reported
    }

    pub(in crate::check) fn early_grammar_error_on_node(
        &mut self,
        file: FileId,
        node: impl ToNode,
        code: u32,
        args: &[Arg<'_>],
    ) -> bool {
        let is_reported = !has_parse_diagnostics(self.hir(file));
        if is_reported {
            self.early_error_on_node(file, node, code, args);
        }
        is_reported
    }

    pub(in crate::check) fn early_grammar_error_on_token_before(
        &mut self,
        file: FileId,
        position: u32,
        token: &[u8],
        code: u32,
    ) -> bool {
        start_of_token_before(&self.hir(file).text, position, token).is_some_and(|start| {
            self.early_grammar_error_at((file, start, start + token.len() as u32), code, &[])
        })
    }

    pub(in crate::check) fn early_grammar_error_on_token_after(
        &mut self,
        file: FileId,
        end: u32,
        token: u8,
        code: u32,
    ) -> bool {
        let text = &self.hir(file).text;
        let start = skip_trivia(text, end as usize) as u32;
        text.get(start as usize) == Some(&token)
            && self.early_grammar_error_at((file, start, start + 1), code, &[])
    }

    pub(in crate::check) fn error_with_class(
        &mut self,
        at: (FileId, u32, u32),
        code: u32,
        args: &[Arg<'_>],
        class: DiagnosticClass,
    ) -> &mut Reported {
        let reported = self.error_at(at, code, args);
        reported.class = class;
        reported
    }
}

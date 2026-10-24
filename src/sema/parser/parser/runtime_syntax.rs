use super::{Parser, ctx};
use crate::Options;
use crate::token::T;
use bun_sema::atom::known;
use bun_sema::hir::*;
use bun_sema::util::SharedSort;

#[cfg(test)]
mod tests;

#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Prologue {
    Directives,
    None,
}

#[derive(Copy, Clone)]
pub(super) struct CodeDialect {
    is_ecmascript: bool,
    compiles: bool,
}

const EMPTY_TEMPLATE_PART: TemplatePart = TemplatePart {
    cooked: Some(known::empty),
    raw: known::empty,
};

pub(super) fn class_in_comment(kind: DiagnosticKind) -> DiagnosticClass {
    match kind {
        DiagnosticKind::Checker => DiagnosticClass::Semantic,
        _ => DiagnosticClass::TypeScriptGrammar,
    }
}

pub(super) fn pragma_error_kind(
    options: &Options,
    is_compiled_javascript: bool,
) -> Option<DiagnosticKind> {
    match (is_compiled_javascript, options.recovers) {
        (true, _) => Some(DiagnosticKind::JsDoc),
        (false, true) => Some(DiagnosticKind::Parse),
        (false, false) => None,
    }
}

impl<const GENERAL: bool, const COMMENTS: bool> Parser<'_, GENERAL, COMMENTS> {
    #[inline(always)]
    pub(super) fn flags_of(&self, kind: &ExprKind) -> ExprFlags {
        match *kind {
            ExprKind::Call(call)
                if (self.f.calls.get(call.idx())).is_some_and(|it| it.chain == Chain::Start) =>
            {
                ExprFlags::OPTIONAL_CHAIN_LINK
            }
            _ => kind_flags(kind),
        }
    }

    #[inline(always)]
    pub(super) fn note_private_name(&mut self, dot: ExprId, name_pos: u32) {
        if self.lx.src.get(name_pos as usize) == Some(&b'#') {
            self.f.add_flags(dot, ExprFlags::PRIVATE_NAME);
        }
    }

    #[inline(always)]
    pub(super) fn note_parentheses(&mut self, expression: ExprId) {
        if expression.is_some() {
            self.f.add_flags(expression, ExprFlags::PARENTHESIZED);
        }
    }

    pub(super) fn regex_kind(&mut self) -> ExprKind {
        if self.token() != T::Regex {
            return ExprKind::Regex {
                pattern: known::empty,
                flags: known::empty,
            };
        }
        let text = self.lx.text();
        let start = self.lx.start as usize;
        let close = match bun_core::strings::last_index_of_char(text, b'/') {
            Some(at) if at > 0 => at,
            _ => text.len(),
        };
        let is_well_formed = core::str::from_utf8(text).is_ok();
        let pattern = (self.lx).atom_of_written(start + 1, start + close, is_well_formed);
        let flags = match text.get(close + 1..) {
            Some(flags) if !flags.is_empty() => self.atom(flags),
            _ => known::empty,
        };
        ExprKind::Regex { pattern, flags }
    }

    pub(super) fn push_template_part(&mut self) {
        if self.has_failed() {
            return self.push_missing_template_part();
        }
        let cooked = (!self.lx.has_escape).then_some(self.lx.atom);
        let raw = self.lx.template_raw();
        self.s.template_parts.push(TemplatePart { cooked, raw });
    }

    pub(super) fn push_missing_template_part(&mut self) {
        self.s.template_parts.push(EMPTY_TEMPLATE_PART);
    }

    pub(super) fn take_template_parts(&mut self, base: usize) {
        let first = self.f.template_parts.len() as u32;
        let parts = self.s.template_parts.get(base..).unwrap_or_default();
        self.f.template_parts.extend_from_slice(parts);
        self.s.template_parts.truncate(base);
        let template = ExprId(self.f.exprs.len() as u32);
        self.f.template_part_starts.push((template, first));
    }

    pub(super) fn take_directive(&mut self, statement: StmtId) -> bool {
        let Some(&Stmt {
            kind: StmtKind::Expr(expr),
            ..
        }) = self.f.stmts.get(statement.idx())
        else {
            return !self.f.is_js && self.f.is_erased_statement(statement);
        };
        let Some(&Expr {
            kind: ExprKind::String(_),
            pos,
            end,
        }) = self.f.exprs.get(expr.idx())
        else {
            return false;
        };
        let not_directive = ExprFlags::PARENTHESIZED | ExprFlags::TEMPLATE_LITERAL;
        if self.f.expr_flags(expr).intersects(not_directive) {
            return false;
        }
        let src = self.lx.src;
        let text = src.get(pos as usize + 1..end.saturating_sub(1) as usize);
        let raw = self.atom(text.unwrap_or_default());
        if let Some(it) = self.f.stmts.get_mut(statement.idx()) {
            it.kind = StmtKind::Directive { expr, raw };
        }
        if raw == known::use_strict {
            match self.has_context(ctx::TOP_LEVEL) {
                true => self.context |= ctx::STRICT,
                false if self.options.keeps_function_directives => {
                    self.context |= ctx::STRICT;
                    self.f.rare_syntax |= rare::DIRECTIVE_IN_FUNCTION;
                }
                false => self.f.rare_syntax |= rare::DROPPED_STRICT_DIRECTIVE,
            }
        }
        true
    }

    pub(super) fn is_strict_body(&self, body: FnBody) -> bool {
        self.has_context(ctx::STRICT)
            || self.options.keeps_function_directives
                && self.f.rare_syntax & rare::DIRECTIVE_IN_FUNCTION != 0
                && self.f.has_use_strict_directive(body)
    }

    pub(super) fn is_module_declaration(&self, statement: StmtId) -> bool {
        let is_import = |it: &Stmt| matches!(it.kind, StmtKind::Import(_));
        self.f.is_export_declaration(statement)
            || self.f.is_js && self.f.stmts.get(statement.idx()).is_some_and(is_import)
    }

    pub(super) fn set_file_strictness(&mut self, has_module_declaration: bool) {
        if has_module_declaration {
            return self.f.set_strict_by_syntax();
        }
        let is_strict = self.has_context(ctx::STRICT);
        self.f.is_strict = is_strict;
        self.f.is_strict_by_syntax = is_strict;
    }

    pub(super) fn sort_runtime_side_tables(&mut self) {
        if !self.f.template_part_starts.is_sorted_by_key(|it| it.0.0) {
            self.f
                .template_part_starts
                .shared_sort_unstable_by_key(|it| it.0.0);
        }
        if !self.f.jsx_attribute_texts.is_sorted_by_key(|it| it.0.0) {
            self.f
                .jsx_attribute_texts
                .shared_sort_unstable_by_key(|it| it.0.0);
        }
        if !self.f.export_star_attributes.is_sorted_by_key(|it| it.0.0) {
            self.f
                .export_star_attributes
                .shared_sort_unstable_by_key(|it| it.0.0);
        }
        if !self.f.bigint_names.is_sorted_by_key(|it| it.0) {
            self.f.bigint_names.shared_sort_unstable_by_key(|it| it.0);
        }
        self.f.bigint_names.dedup_by_key(|it| it.0);
    }

    pub(super) fn text_start_after_modifiers(&self, base: usize) -> u32 {
        let is_async = |it: &&Modifier| it.kind == ModifierKind::Keyword(Flags::ASYNC);
        let written = self.s.modifiers.get(base..).unwrap_or_default();
        written
            .iter()
            .rfind(is_async)
            .map_or_else(|| self.pos(), |it| it.pos)
    }

    pub(super) fn attributes_since(&self, base: usize) -> ExprId {
        let parsed = self.f.import_attributes.get(base..).unwrap_or_default();
        parsed.last().map_or(ExprId::NONE, |it| it.1)
    }

    #[cold]
    #[inline(never)]
    pub(super) fn flag_early_error(&mut self, code: u32, at: (u32, u32), args: &[&[u8]]) {
        let error = Diagnostic::new(DiagnosticKind::Grammar, at, code, args);
        self.f
            .diagnostics
            .push(error.with_class(DiagnosticClass::EarlyError));
    }

    #[cold]
    #[inline(never)]
    pub(super) fn flag_with_class(
        &mut self,
        kind: DiagnosticKind,
        class: DiagnosticClass,
        code: u32,
        at: (u32, u32),
    ) {
        let error = Diagnostic::new(kind, at, code, &[]);
        self.f.diagnostics.push(error.with_class(class));
    }

    pub(super) fn enter_typescript_dialect(&mut self) -> CodeDialect {
        let outer = CodeDialect {
            is_ecmascript: self.is_ecmascript,
            compiles: self.lx.compiles,
        };
        self.is_ecmascript = false;
        self.lx.is_ecmascript = false;
        self.lx.compiles = false;
        outer
    }

    pub(super) fn leave_typescript_dialect(&mut self, outer: CodeDialect) {
        self.is_ecmascript = outer.is_ecmascript;
        self.lx.is_ecmascript = outer.is_ecmascript;
        self.lx.compiles = outer.compiles;
    }
}

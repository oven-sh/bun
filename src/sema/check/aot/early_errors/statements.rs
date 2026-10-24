use crate::bind::Parent;
use crate::check::explain::NO_LENGTH;
use crate::check::*;

#[derive(Copy, Clone)]
enum BodyDeclaration {
    Function(FnId),
    Class,
}

impl Checker<'_, '_> {
    pub(super) fn check_statement_early_errors(&mut self, file: FileId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for s in (0..hir.stmts.len() as u32).map(StmtId) {
            if matches!(bound.parent_of_stmt(s), Parent::None) {
                continue;
            }
            if !hir.stmt_modifiers(s).is_empty() {
                self.check_grammar_modifiers_of_statement(file, s);
            }
            self.check_statement_syntax(file, s);
        }
    }

    fn check_statement_syntax(&mut self, file: FileId, s: StmtId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        match hir[s].kind {
            StmtKind::Var(decls) => {
                if !is_loop_head(hir, bound, s) {
                    self.check_grammar_variable_statement(file, s, decls);
                    self.check_variable_declarations(file, decls, Kind::VariableStatement);
                }
            }
            StmtKind::For { init, .. } => {
                if let Some(init) = init.some()
                    && let StmtKind::Var(decls) = hir[init].kind
                {
                    self.check_grammar_variable_declaration_list(file, init, decls);
                    self.check_variable_declarations(file, decls, Kind::ForStatement);
                }
            }
            StmtKind::ForIn { left, .. } => {
                self.check_grammar_for_in_or_for_of_statement(file, s, left);
                self.check_loop_head(file, s, left, true);
            }
            StmtKind::ForOf { left, is_await, .. } => {
                self.check_grammar_for_in_or_for_of_statement(file, s, left);
                if is_await {
                    self.check_for_await_in_class_static_block(file, s);
                }
                self.check_loop_head(file, s, left, false);
            }
            StmtKind::Return(_) => {
                self.check_grammar_return_statement(file, s);
            }
            StmtKind::Break(_) | StmtKind::Continue(_) => {
                self.check_grammar_break_or_continue_statement(file, s);
            }
            StmtKind::Labeled { label, .. } => self.check_grammar_duplicate_label(file, s, label),
            StmtKind::Throw(e) => {
                if matches!(hir[e].kind, ExprKind::Missing) {
                    self.early_grammar_error_at((file, hir[e].pos, NO_LENGTH), 1142, &[]);
                }
            }
            StmtKind::Try { param, .. } => {
                if let Some(param) = param.some()
                    && hir[param].init.is_some()
                {
                    let start = self.start_of(file, hir[param].init);
                    self.early_grammar_error_at((file, start, 0), 1197, &[]);
                }
            }
            StmtKind::Fn(f) => {
                self.check_declaration_as_body(file, s, BodyDeclaration::Function(f));
            }
            StmtKind::Class(c) => {
                self.check_declaration_as_body(file, s, BodyDeclaration::Class);
                let class = &hir[c];
                if class.name.is_none()
                    && !class.flags.contains(Flags::DEFAULT)
                    && hir
                        .find_modifier(hir.stmt_modifiers(s), Flags::DEFAULT)
                        .is_none()
                {
                    self.early_grammar_error_at((file, class.start, 0), 1211, &[]);
                }
            }
            StmtKind::Import(_) if hir.is_in_jsdoc(hir[s].start) => {}
            StmtKind::Import(_) => {
                let code = if hir.is_js { 1473 } else { 1232 };
                self.check_module_syntax_position(file, s, code);
                self.check_import_attribute_values(file, s);
            }
            StmtKind::ExportNamed(_) | StmtKind::ExportStar { .. } => {
                let code = if hir.is_js { 1474 } else { 1233 };
                self.check_module_syntax_position(file, s, code);
                self.check_import_attribute_values(file, s);
            }
            StmtKind::ExportDefault(_) => {
                self.check_module_syntax_position(file, s, 1258);
            }
            StmtKind::Empty
            | StmtKind::Debugger
            | StmtKind::Expr(_)
            | StmtKind::Directive { .. }
            | StmtKind::Block(_)
            | StmtKind::If { .. }
            | StmtKind::While { .. }
            | StmtKind::DoWhile { .. }
            | StmtKind::With { .. }
            | StmtKind::Switch { .. }
            | StmtKind::Interface(_)
            | StmtKind::TypeAlias(_)
            | StmtKind::Enum(_)
            | StmtKind::Module(_)
            | StmtKind::ImportEquals(_)
            | StmtKind::ExportAssign(_)
            | StmtKind::ExportAsNamespace(_) => {}
        }
    }

    fn check_variable_declarations(
        &mut self,
        file: FileId,
        decls: Span<VarDeclId>,
        list_parent: Kind,
    ) {
        let hir = self.hir(file);
        for d in decls
            .iter()
            .filter(|&d| !hir[d].flags.contains(Flags::AMBIENT))
        {
            self.check_grammar_variable_declaration(file, d, list_parent);
        }
    }

    fn check_loop_head(&mut self, file: FileId, s: StmtId, left: StmtId, is_for_in: bool) {
        match self.hir(file)[left].kind {
            StmtKind::Var(decls) => {
                let list_parent = if is_for_in {
                    Kind::ForInStatement
                } else {
                    Kind::ForOfStatement
                };
                self.check_variable_declarations(file, decls, list_parent);
            }
            StmtKind::Expr(target) => {
                if self.is_for_async_of(file, s) {
                    self.early_grammar_error_on_node(file, target, 1106, &[]);
                }
                self.check_loop_target_early_errors(file, target, is_for_in);
            }
            StmtKind::Empty
            | StmtKind::Debugger
            | StmtKind::Fn(_)
            | StmtKind::Class(_)
            | StmtKind::Interface(_)
            | StmtKind::TypeAlias(_)
            | StmtKind::Enum(_)
            | StmtKind::Module(_)
            | StmtKind::Return(_)
            | StmtKind::If { .. }
            | StmtKind::For { .. }
            | StmtKind::ForIn { .. }
            | StmtKind::ForOf { .. }
            | StmtKind::While { .. }
            | StmtKind::DoWhile { .. }
            | StmtKind::Block(_)
            | StmtKind::Switch { .. }
            | StmtKind::Try { .. }
            | StmtKind::Throw(_)
            | StmtKind::Break(_)
            | StmtKind::Continue(_)
            | StmtKind::Labeled { .. }
            | StmtKind::Import(_)
            | StmtKind::ImportEquals(_)
            | StmtKind::ExportNamed(_)
            | StmtKind::ExportStar { .. }
            | StmtKind::ExportDefault(_)
            | StmtKind::ExportAssign(_)
            | StmtKind::ExportAsNamespace(_)
            | StmtKind::With { .. }
            | StmtKind::Directive { .. } => {}
        }
    }

    fn check_declaration_as_body(&mut self, file: FileId, s: StmtId, declaration: BodyDeclaration) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if hir.rare_syntax & rare::DECLARATION_AS_BODY == 0 {
            return;
        }
        let (mut outer, mut is_labeled) = (s, false);
        while let Some(parent) = statement_parent(bound, outer)
            && matches!(hir[parent].kind, StmtKind::Labeled { .. })
        {
            outer = parent;
            is_labeled = true;
        }
        let Some(enclosing_statement) = statement_parent(bound, outer) else {
            return;
        };
        let is_loop_or_with_body = matches!(
            hir[enclosing_statement].kind,
            StmtKind::For { body, .. }
                | StmtKind::ForIn { body, .. }
                | StmtKind::ForOf { body, .. }
                | StmtKind::While { body, .. }
                | StmtKind::DoWhile { body, .. }
                | StmtKind::With { body, .. }
                if body == outer
        );
        let is_if_branch = matches!(
            hir[enclosing_statement].kind,
            StmtKind::If { yes, no, .. } if yes == outer || no == outer
        );
        if !is_loop_or_with_body && !is_if_branch {
            return;
        }
        let (keyword, is_error) = match declaration {
            BodyDeclaration::Function(f) => (
                "function",
                is_loop_or_with_body
                    || is_labeled
                    || hir[f].flags.intersects(Flags::ASYNC | Flags::GENERATOR),
            ),
            BodyDeclaration::Class => ("class", true),
        };
        if is_error {
            let at = (file, hir[s].start, hir[s].loc.end);
            self.early_error_at(at, 1156, &[Arg::Text(keyword)]);
        }
    }

    fn check_module_syntax_position(&mut self, file: FileId, s: StmtId, code: u32) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if !matches!(bound.parent_of_stmt(s), Parent::File | Parent::Module(_)) {
            self.early_grammar_error_at((file, hir[s].start, 0), code, &[]);
        }
    }

    fn check_import_attribute_values(&mut self, file: FileId, s: StmtId) {
        let hir = self.hir(file);
        let Some(attributes) = hir.statement_import_attributes(s).some() else {
            return;
        };
        let ExprKind::Object(props) = hir[attributes].kind else {
            return;
        };
        let not_string_literal = ExprFlags::TEMPLATE_LITERAL | ExprFlags::PARENTHESIZED;
        for p in props.iter() {
            let Some(value) = hir[p].value.some() else {
                continue;
            };
            let is_string = matches!(hir[value].kind, ExprKind::String(_))
                && !hir.expr_flags(value).intersects(not_string_literal);
            if !is_string && !matches!(hir[value].kind, ExprKind::Missing) {
                let at = (
                    file,
                    self.start_of(file, value),
                    self.end_of_expr(file, value),
                );
                self.early_error_at(at, 2858, &[]);
            }
        }
    }
}

fn statement_parent(bound: &Bound<'_>, s: StmtId) -> Option<StmtId> {
    if let Parent::Stmt(parent) = bound.parent_of_stmt(s) {
        parent.some()
    } else {
        None
    }
}

fn is_loop_head(hir: &File<'_>, bound: &Bound<'_>, s: StmtId) -> bool {
    statement_parent(bound, s).is_some_and(|parent| {
        matches!(
            hir[parent].kind,
            StmtKind::For { init: head, .. }
                | StmtKind::ForIn { left: head, .. }
                | StmtKind::ForOf { left: head, .. }
                if head == s
        )
    })
}

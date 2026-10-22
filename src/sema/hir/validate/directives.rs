use super::super::{
    ExprFlags, ExprId, File, FileKind, FnBody, FnKind, Func, IdList, NodeData, StmtId, StmtKind,
};
use super::{CheckResult, FileRule, invalid, is_string};

fn is_plain_string(file: &File<'_>, id: ExprId) -> bool {
    let non_plain_flags = ExprFlags::PARENTHESIZED | ExprFlags::TEMPLATE_LITERAL;
    is_string(file, id) && !file.expr_flags(id).intersects(non_plain_flags)
}

#[derive(Copy, Clone)]
enum ListPosition {
    Unlisted,
    Member,
    Prologue,
    MissedDirective,
}

struct ListPositions<'f, 's> {
    file: &'f File<'s>,
    positions: Vec<ListPosition>,
}

impl ListPositions<'_, '_> {
    fn set(&mut self, stmt: StmtId, position: ListPosition) {
        if let Some(slot) = self.positions.get_mut(stmt.idx()) {
            *slot = position;
        }
    }

    fn add_list(&mut self, list: IdList<StmtId>) {
        let file = self.file;
        for stmt in file.ids(list) {
            self.set(stmt, ListPosition::Member);
        }
    }

    fn add_prologue_list(&mut self, list: IdList<StmtId>) {
        let file = self.file;
        let mut in_prologue = true;
        for id in file.ids(list) {
            let Some(stmt) = file.stmts.get(id.idx()) else {
                continue;
            };
            let position = match stmt.kind {
                StmtKind::Directive { .. } if in_prologue => ListPosition::Prologue,
                _ if file.is_in_jsdoc(stmt.start) => ListPosition::Member,
                _ if !file.is_js && file.is_erased_statement(id) => ListPosition::Member,
                StmtKind::Expr(expr) if in_prologue && is_plain_string(file, expr) => {
                    in_prologue = false;
                    ListPosition::MissedDirective
                }
                _ => {
                    in_prologue = false;
                    ListPosition::Member
                }
            };
            self.set(id, position);
        }
    }

    fn add_function(&mut self, function: &Func) {
        match function.body {
            FnBody::None | FnBody::Expr(_) => {}
            FnBody::Block(list) if function.kind == FnKind::StaticBlock => self.add_list(list),
            FnBody::Block(list) => self.add_prologue_list(list),
        }
    }

    fn add_stmt_children(&mut self, kind: StmtKind) {
        let file = self.file;
        match kind {
            StmtKind::Block(list) => self.add_list(list),
            StmtKind::Switch { cases, .. } => {
                for case in &file.cases[cases.range()] {
                    self.add_list(case.body);
                }
            }
            StmtKind::Module(module) => self.add_list(file[module].body),
            StmtKind::If { yes, no, .. } => {
                self.set(yes, ListPosition::Member);
                self.set(no, ListPosition::Member);
            }
            StmtKind::For { body, .. }
            | StmtKind::ForIn { body, .. }
            | StmtKind::ForOf { body, .. }
            | StmtKind::While { body, .. }
            | StmtKind::DoWhile { body, .. }
            | StmtKind::Labeled { body, .. }
            | StmtKind::With { body, .. } => self.set(body, ListPosition::Member),
            StmtKind::Empty
            | StmtKind::Debugger
            | StmtKind::Expr(_)
            | StmtKind::Var(_)
            | StmtKind::Fn(_)
            | StmtKind::Class(_)
            | StmtKind::Interface(_)
            | StmtKind::TypeAlias(_)
            | StmtKind::Enum(_)
            | StmtKind::Return(_)
            | StmtKind::Try { .. }
            | StmtKind::Throw(_)
            | StmtKind::Break(_)
            | StmtKind::Continue(_)
            | StmtKind::Import(_)
            | StmtKind::ImportEquals(_)
            | StmtKind::ExportNamed(_)
            | StmtKind::ExportStar { .. }
            | StmtKind::ExportDefault(_)
            | StmtKind::ExportAssign(_)
            | StmtKind::ExportAsNamespace(_)
            | StmtKind::Directive { .. } => {}
        }
    }
}

pub(super) fn check_directives(file: &File<'_>) -> CheckResult {
    let positions = vec![ListPosition::Unlisted; file.stmts.len()];
    let mut lists = ListPositions { file, positions };
    if file.kind == FileKind::Json {
        lists.add_list(file.body);
    } else {
        lists.add_prologue_list(file.body);
    }
    for function in file.fns.iter() {
        lists.add_function(function);
    }
    for stmt in file.stmts.iter() {
        lists.add_stmt_children(stmt.kind);
    }
    for (index, stmt) in file.stmts.iter().enumerate() {
        let is_valid = match (lists.positions[index], stmt.kind) {
            (ListPosition::Unlisted, _) => true,
            (ListPosition::MissedDirective, _) => false,
            (ListPosition::Prologue, StmtKind::Directive { expr, .. }) => {
                is_plain_string(file, expr)
            }
            (ListPosition::Member, StmtKind::Directive { .. }) => false,
            (ListPosition::Prologue | ListPosition::Member, _) => true,
        };
        if !is_valid {
            let node = NodeData::Stmt(StmtId(index as u32));
            return invalid(FileRule::DirectiveOutsidePrologue, node);
        }
    }
    Ok(())
}

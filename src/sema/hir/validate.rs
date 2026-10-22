use super::{ExprId, ExprKind, File, NodeData};

mod directives;
mod flags;
mod order;
mod ranges;
#[cfg(all(test, not(miri)))]
mod tests;

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum FileRule {
    IdOutOfRange,
    ListOutOfRange,
    OperandAfterExpression,
    UnsortedSideTable,
    ColumnLengthMismatch,
    FlagMismatch,
    DirectiveOutsidePrologue,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct InvalidFile {
    pub rule: FileRule,
    pub node: NodeData,
}

type CheckResult = Result<(), InvalidFile>;

impl File<'_> {
    /// A file with syntax errors is partial, and valid.
    pub fn validate(&self) -> Result<(), InvalidFile> {
        if self.has_errors || self.has_parse_diagnostics {
            return Ok(());
        }
        check_columns(self)?;
        ranges::check_ranges(self)?;
        order::check_operand_order(self)?;
        order::check_side_table_order(self)?;
        flags::check_flags(self)?;
        directives::check_directives(self)
    }
}

fn invalid(rule: FileRule, node: NodeData) -> CheckResult {
    Err(InvalidFile { rule, node })
}

fn check_columns(file: &File<'_>) -> CheckResult {
    if file.expr_flags.len() != file.exprs.len() {
        return invalid(FileRule::ColumnLengthMismatch, NodeData::File);
    }
    for &(template, first) in file.template_part_starts.iter() {
        let len = file.template_part_count(template);
        if first as usize + len > file.template_parts.len() {
            return invalid(FileRule::ColumnLengthMismatch, NodeData::Expr(template));
        }
    }
    Ok(())
}

fn is_string(file: &File<'_>, id: ExprId) -> bool {
    let kind = file.exprs.get(id.idx()).map(|expr| expr.kind);
    matches!(kind, Some(ExprKind::String(_)))
}

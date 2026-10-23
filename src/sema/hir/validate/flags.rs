use super::super::expr_flags::chain_flags;
use super::super::{ExprFlags, ExprId, ExprKind, File, NodeData, StmtKind};
use super::{CheckResult, FileRule, invalid, is_string};

pub(super) fn check_flags(file: &File<'_>) -> CheckResult {
    let mut next_paren = 0;
    for (index, expr) in file.exprs.iter().enumerate() {
        let id = ExprId(index as u32);
        let mut has_parens = false;
        while file
            .parens
            .get(next_paren)
            .is_some_and(|paren| paren.0 == id)
        {
            has_parens = true;
            next_paren += 1;
        }
        let flags = file.expr_flags(id);
        let (required, optional) = required_and_optional_flags(file, &expr.kind);
        let other_flags = flags - ExprFlags::PARENTHESIZED;
        if has_parens != flags.contains(ExprFlags::PARENTHESIZED)
            || !other_flags.contains(required)
            || !(required | optional).contains(other_flags)
        {
            return invalid(FileRule::FlagMismatch, NodeData::Expr(id));
        }
    }
    check_side_table_kinds(file)
}

fn required_and_optional_flags(file: &File<'_>, kind: &ExprKind) -> (ExprFlags, ExprFlags) {
    let none = ExprFlags::empty();
    match *kind {
        ExprKind::Index { chain, .. } => (ExprFlags::BRACKET_ACCESS | chain_flags(chain), none),
        ExprKind::Dot { chain, .. } => (chain_flags(chain), ExprFlags::PRIVATE_NAME),
        ExprKind::Call(call) => (
            chain_flags(file[call].chain),
            ExprFlags::RESOLVED_AT_RUNTIME,
        ),
        ExprKind::PrivateIdentifier(_) => (ExprFlags::PRIVATE_NAME, none),
        ExprKind::String(_) => (none, ExprFlags::TEMPLATE_LITERAL),
        ExprKind::Missing
        | ExprKind::Ident(_)
        | ExprKind::This
        | ExprKind::Super
        | ExprKind::Null
        | ExprKind::True
        | ExprKind::False
        | ExprKind::Number(_)
        | ExprKind::BigInt(_)
        | ExprKind::Regex { .. }
        | ExprKind::Template { .. }
        | ExprKind::TaggedTemplate(_)
        | ExprKind::Array(_)
        | ExprKind::Object(_)
        | ExprKind::Fn(_)
        | ExprKind::Class(_)
        | ExprKind::New(_)
        | ExprKind::Unary { .. }
        | ExprKind::Binary { .. }
        | ExprKind::Assign { .. }
        | ExprKind::Cond { .. }
        | ExprKind::Spread(_)
        | ExprKind::Await(_)
        | ExprKind::Yield { .. }
        | ExprKind::As { .. }
        | ExprKind::Satisfies { .. }
        | ExprKind::AsConst(_)
        | ExprKind::NonNull(_)
        | ExprKind::Instantiation { .. }
        | ExprKind::Jsx(_)
        | ExprKind::ImportCall { .. }
        | ExprKind::ImportMeta
        | ExprKind::NewTarget(_)
        | ExprKind::JsxText(_) => (none, none),
    }
}

fn check_side_table_kinds(file: &File<'_>) -> CheckResult {
    for &(id, _) in file.jsx_attribute_texts.iter() {
        if !is_string(file, id) {
            return invalid(FileRule::FlagMismatch, NodeData::Expr(id));
        }
    }
    for &(id, _) in file.template_part_starts.iter() {
        let kind = file.exprs.get(id.idx()).map(|expr| expr.kind);
        if !matches!(kind, Some(ExprKind::Template { .. } | ExprKind::String(_))) {
            return invalid(FileRule::FlagMismatch, NodeData::Expr(id));
        }
    }
    for &(id, _) in file.export_star_attributes.iter() {
        let kind = file.stmts.get(id.idx()).map(|stmt| stmt.kind);
        if !matches!(kind, Some(StmtKind::ExportStar { .. })) {
            return invalid(FileRule::FlagMismatch, NodeData::Stmt(id));
        }
    }
    Ok(())
}

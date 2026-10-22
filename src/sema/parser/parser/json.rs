//! Parses a JSON file as a source file (`parseJSONText`).

use super::Parser;
use crate::token::T;
use bun_sema::hir::*;

impl<const GENERAL: bool, const COMMENTS: bool> Parser<'_, GENERAL, COMMENTS> {
    /// `parseJSONText`. Called at the first token. Parses the file's value and returns it as an `export =` statement,
    /// which is how `bindSourceFileIfExternalModule` treats a JSON file. Reporting invalid JSON is left to
    /// `bun_sema::json::validate_json`.
    pub(crate) fn json_text(&mut self) -> StmtId {
        let start = self.pos();
        let base = self.s.ids.len();
        // No statement list is open.
        self.lists = 0;
        while self.token() != T::Eof {
            let is_not_property_name = |p: &mut Self| {
                p.next();
                p.token() != T::Colon
            };
            let is_value = match self.token() {
                T::OpenBracket | T::True | T::False | T::Null => true,
                T::Minus => self.look_ahead(|p| {
                    p.next();
                    p.token() == T::Number && is_not_property_name(p)
                }),
                T::Number | T::String => self.look_ahead(is_not_property_name),
                _ => false,
            };
            let expression = match self.token() {
                T::Minus if is_value => {
                    let minus = self.pos();
                    self.next();
                    let operand = self.left_hand_side_expression();
                    let op = UnOp::Minus;
                    self.finish_expr(ExprKind::Unary { op, operand }, minus)
                }
                _ if is_value => self.primary_expression(),
                _ => self.object_literal(),
            };
            if self.has_failed() {
                break;
            }
            self.s.ids.push(expression.0);
            // "Error recovery: collect multiple top-level expressions"
            if self.s.ids.len() == base + 1 && self.token() != T::Eof {
                self.error_at_token(1012, &[]);
            }
        }
        let only = self.s.ids.get(base).copied();
        let value = match (self.s.ids.len() - base, only) {
            (1, Some(only)) => {
                self.s.ids.truncate(base);
                ExprId(only)
            }
            (0, _) => self.add_expr(ExprKind::Object(Span::EMPTY), start, start),
            _ => {
                let elements = self.take_ids(base);
                self.finish_expr(ExprKind::Array(elements), start)
            }
        };
        // The statement is synthetic, so it has no range in the text.
        let id = StmtId(self.f.stmts.len() as u32);
        self.f.stmts.push(Stmt {
            kind: StmtKind::ExportAssign(value),
            start: 0,
            loc: TextRange::default(),
        });
        id
    }
}

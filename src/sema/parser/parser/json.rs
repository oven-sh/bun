//! A JSON file as a source file: `parseJSONText`.

use super::Parser;
use super::stmt::Start;
use crate::token::T;
use bun_sema::hir::*;

impl Parser<'_> {
    /// `parseJSONText`, at the first token: the value of the file. `bindSourceFileIfExternalModule`:
    /// the file is an `export =` of it. What is no JSON is left to `bun_sema::json::validate_json`.
    pub(crate) fn json_text(&mut self) -> StmtId {
        let start = self.pos();
        let base = self.s.ids.len();
        while self.token() != T::Eof {
            let is_no_name = |p: &mut Self| {
                p.next();
                p.token() != T::Colon
            };
            let is_value = match self.token() {
                T::OpenBracket | T::True | T::False | T::Null => true,
                T::Minus => self.look_ahead(|p| {
                    p.next();
                    p.token() == T::Number && is_no_name(p)
                }),
                T::Number | T::String => self.look_ahead(is_no_name),
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
                T::OpenBrace => self.object_literal(),
                // `parseObjectLiteralExpression` without its `{`
                _ => {
                    self.fail();
                    break;
                }
            };
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
        let whole = Start { pos: 0, full: 0 };
        self.add_stmt(StmtKind::ExportAssign(value), whole, Span::EMPTY)
    }
}

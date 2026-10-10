//! Questions about operators.

use bun_lint::ast::{BinOp, UnOp};

/// How tightly an operator binds. Only the order matters.
#[derive(Debug, Clone, Copy, Eq, PartialEq, PartialOrd, Ord)]
pub(crate) enum Precedence {
    Comma,
    NullishCoalescing,
    LogicalOr,
    LogicalAnd,
    BitwiseOr,
    BitwiseXor,
    BitwiseAnd,
    Equals,
    Compare,
    Shift,
    Add,
    Multiply,
    Exponentiation,
}

impl Precedence {
    pub(crate) fn is_bitwise(self) -> bool {
        matches!(self, Self::BitwiseOr | Self::BitwiseXor | Self::BitwiseAnd)
    }

    pub(crate) fn is_shift(self) -> bool {
        matches!(self, Self::Shift)
    }

    pub(crate) fn is_additive(self) -> bool {
        matches!(self, Self::Add)
    }
}

pub(crate) trait BinOpExt: Copy {
    fn precedence(self) -> Precedence;
    fn as_str(self) -> &'static str;
    /// `&&`, `||`, `??`: ESTree's `LogicalExpression`.
    fn is_logical(self) -> bool;
    fn is_remainder(self) -> bool;
}

impl BinOpExt for BinOp {
    fn precedence(self) -> Precedence {
        match self {
            BinOp::Comma => Precedence::Comma,
            BinOp::Nullish => Precedence::NullishCoalescing,
            BinOp::Or => Precedence::LogicalOr,
            BinOp::And => Precedence::LogicalAnd,
            BinOp::BitOr => Precedence::BitwiseOr,
            BinOp::BitXor => Precedence::BitwiseXor,
            BinOp::BitAnd => Precedence::BitwiseAnd,
            BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq => Precedence::Equals,
            BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge | BinOp::In | BinOp::Instanceof => {
                Precedence::Compare
            }
            BinOp::Shl | BinOp::Shr | BinOp::UShr => Precedence::Shift,
            BinOp::Add | BinOp::Sub => Precedence::Add,
            BinOp::Mul | BinOp::Div | BinOp::Rem => Precedence::Multiply,
            BinOp::Pow => Precedence::Exponentiation,
        }
    }

    #[inline]
    fn as_str(self) -> &'static str {
        bun_lint::ast::bin_op_text(self)
    }

    #[inline]
    fn is_logical(self) -> bool {
        matches!(self, BinOp::And | BinOp::Or | BinOp::Nullish)
    }

    #[inline]
    fn is_remainder(self) -> bool {
        self == BinOp::Rem
    }
}

pub(crate) trait UnOpExt: Copy {
    fn as_str(self) -> &'static str;
    /// `typeof`, `void`, `delete`
    fn is_keyword(self) -> bool;
    /// `++`, `--`: ESTree's `UpdateExpression`.
    fn is_update(self) -> bool;
    /// `++a`, `--a`, as opposed to `a++`, `a--`.
    fn is_prefix(self) -> bool;
}

impl UnOpExt for UnOp {
    #[inline]
    fn as_str(self) -> &'static str {
        bun_lint::ast::un_op_text(self)
    }

    #[inline]
    fn is_keyword(self) -> bool {
        matches!(self, UnOp::Typeof | UnOp::Void | UnOp::Delete)
    }

    #[inline]
    fn is_update(self) -> bool {
        matches!(
            self,
            UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec
        )
    }

    #[inline]
    fn is_prefix(self) -> bool {
        !matches!(self, UnOp::PostInc | UnOp::PostDec)
    }
}

/// `=`, `+=`, ..: `op` is the operator of a compound assignment.
pub(crate) fn assign_op_text(op: Option<BinOp>) -> &'static str {
    match op {
        None | Some(BinOp::Comma) => "=",
        Some(BinOp::Add) => "+=",
        Some(BinOp::Sub) => "-=",
        Some(BinOp::Mul) => "*=",
        Some(BinOp::Div) => "/=",
        Some(BinOp::Rem) => "%=",
        Some(BinOp::Pow) => "**=",
        Some(BinOp::Shl) => "<<=",
        Some(BinOp::Shr) => ">>=",
        Some(BinOp::UShr) => ">>>=",
        Some(BinOp::BitAnd) => "&=",
        Some(BinOp::BitOr) => "|=",
        Some(BinOp::BitXor) => "^=",
        Some(BinOp::And) => "&&=",
        Some(BinOp::Or) => "||=",
        Some(BinOp::Nullish) => "??=",
        Some(
            BinOp::Lt
            | BinOp::Le
            | BinOp::Gt
            | BinOp::Ge
            | BinOp::EqEq
            | BinOp::NotEq
            | BinOp::EqEqEq
            | BinOp::NotEqEq
            | BinOp::In
            | BinOp::Instanceof,
        ) => "=",
    }
}

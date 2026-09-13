//! Semantic analysis of `_Complex float` / `_Complex double`.
//!
//! (`__int128` needs nothing here: it is an integer type to every rule in `sema.rs`.)
//!
//! A real operand that meets a complex one is converted to the complex type first, with a
//! zero imaginary part; C keeps it real, which only matters for signed zeros and infinities.

use super::Sema;
use crate::ast::*;
use crate::token::{Loc, Res, err};
use crate::types::Type;

impl Sema {
    /// `re + im*i` with both parts already of the part type of `ty`.
    pub(crate) fn complex_make(&self, re: Expr, im: Expr, ty: Type, loc: Loc) -> Res<Expr> {
        self.mk(ExprKind::ComplexMake(Box::new(re), Box::new(im)), ty, loc)
    }

    /// An imaginary constant such as `2.0if`.
    pub(crate) fn imaginary_lit(&self, value: f64, part: &Type, loc: Loc) -> Res<Expr> {
        let re = self.float_lit(0.0, part.clone(), loc)?;
        let im = self.float_lit(value, part.clone(), loc)?;
        self.complex_make(re, im, Type::complex_of(part), loc)
    }

    /// `__builtin_complex(re, im)`.
    pub(crate) fn builtin_complex(&self, re: Expr, im: Expr, loc: Loc) -> Res<Expr> {
        let (re, im) = (self.rvalue(re)?, self.rvalue(im)?);
        if !re.ty.is_float() || re.ty != im.ty {
            return err(
                loc,
                "__builtin_complex needs two operands of the same floating type",
            );
        }
        let ty = Type::complex_of(&re.ty);
        self.complex_make(re, im, ty, loc)
    }

    /// Converts arithmetic or complex `e` to complex type `to`.
    pub(crate) fn to_complex(&self, e: Expr, to: &Type, loc: Loc) -> Res<Expr> {
        if e.ty == *to {
            return Ok(e);
        }
        let Some(part) = to.complex_part() else {
            return err(loc, "internal error: not a complex type");
        };
        if e.ty.is_complex() {
            return self.mk(ExprKind::Cast(Box::new(e)), to.clone(), loc);
        }
        if !e.ty.is_arith() {
            return err(
                loc,
                format!(
                    "cannot convert '{}' to '{}'",
                    self.tcx.display(&e.ty),
                    self.tcx.display(to)
                ),
            );
        }
        let re = self.convert(e, &part, loc)?;
        let im = self.float_lit(0.0, part, loc)?;
        self.complex_make(re, im, to.clone(), loc)
    }

    /// Converts complex `e` to arithmetic or complex type `to`: a real type takes the real part.
    pub(crate) fn from_complex(&self, e: Expr, to: &Type, loc: Loc) -> Res<Expr> {
        if to.is_complex() {
            return self.to_complex(e, to, loc);
        }
        if matches!(to, Type::Bool) {
            return self.complex_truth(e, false, loc);
        }
        if !to.is_arith() {
            return err(
                loc,
                format!(
                    "cannot convert '{}' to '{}'",
                    self.tcx.display(&e.ty),
                    self.tcx.display(to)
                ),
            );
        }
        let real = self.complex_part(e, false, loc)?;
        self.convert(real, to, loc)
    }

    /// The complex type two operands are brought to.
    fn common_complex(&self, a: &Type, b: &Type) -> Type {
        let real = |t: &Type| t.complex_part().unwrap_or_else(|| t.clone());
        match self.arith_common_type(&real(a), &real(b)) {
            Type::Float => Type::ComplexFloat,
            _ => Type::ComplexDouble,
        }
    }

    pub(crate) fn complex_binary(
        &self,
        op: BinOp,
        a: Expr,
        b: Expr,
        spelling: &str,
        loc: Loc,
    ) -> Res<Expr> {
        let ok = |t: &Type| t.is_arith() || t.is_complex();
        let supported = matches!(
            op,
            BinOp::Add | BinOp::Sub | BinOp::Mul | BinOp::Div | BinOp::Eq | BinOp::Ne
        );
        if !supported || !ok(&a.ty) || !ok(&b.ty) {
            return self.bad_operands(spelling, &a, &b, loc);
        }
        let ty = self.common_complex(&a.ty, &b.ty);
        let (aloc, bloc) = (a.loc, b.loc);
        let a = self.to_complex(a, &ty, aloc)?;
        let b = self.to_complex(b, &ty, bloc)?;
        let result = if op.is_compare() { Type::Int } else { ty };
        self.mk(ExprKind::Binary(op, Box::new(a), Box::new(b)), result, loc)
    }

    /// `-z`, or `~z` (the conjugate, a GNU extension).
    pub(crate) fn complex_unary(&self, e: Expr, conjugate: bool, loc: Loc) -> Res<Expr> {
        let ty = e.ty.clone();
        let kind = if conjugate {
            ExprKind::BitNot(Box::new(e))
        } else {
            ExprKind::Neg(Box::new(e))
        };
        self.mk(kind, ty, loc)
    }

    /// `z != 0` (or `z == 0`) as an `int`.
    pub(crate) fn complex_truth(&self, e: Expr, negate: bool, loc: Loc) -> Res<Expr> {
        let zero = self.int_lit(0, Type::Int, loc)?;
        let (op, spelling) = if negate {
            (BinOp::Eq, "==")
        } else {
            (BinOp::Ne, "!=")
        };
        self.complex_binary(op, e, zero, spelling, loc)
    }

    /// `__real__ e` / `__imag__ e`: an lvalue when `e` is.
    pub(crate) fn complex_part(&self, e: Expr, imag: bool, loc: Loc) -> Res<Expr> {
        if let Some(part) = e.ty.unatomic().complex_part() {
            let part = if e.ty.is_volatile() {
                part.volatile()
            } else {
                part
            };
            return self.mk(ExprKind::ComplexPart(Box::new(e), imag), part, loc);
        }
        let e = self.rvalue(e)?;
        if let Some(part) = e.ty.complex_part() {
            return self.mk(ExprKind::ComplexPart(Box::new(e), imag), part, loc);
        }
        if !e.ty.is_arith() {
            return err(
                loc,
                format!(
                    "invalid operand to {} ('{}')",
                    if imag { "__imag__" } else { "__real__" },
                    self.tcx.display(&e.ty)
                ),
            );
        }
        // A real number is its own real part and has no imaginary part.
        if !imag {
            return Ok(e);
        }
        let ty = Self::promoted_type(&e.ty);
        let zero = self.int_lit(0, Type::Int, loc)?;
        let zero = self.convert(zero, &ty, loc)?;
        self.mk(ExprKind::Comma(Box::new(e), Box::new(zero)), ty, loc)
    }

    /// `lhs op= rhs` where either side is complex.
    pub(crate) fn complex_compound_assign(
        &self,
        op: BinOp,
        lhs: Expr,
        rhs: Expr,
        loc: Loc,
    ) -> Res<Expr> {
        let ty = lhs.ty.unatomic().clone();
        if !ty.is_complex() || !matches!(op, BinOp::Add | BinOp::Sub | BinOp::Mul | BinOp::Div) {
            return err(
                loc,
                format!(
                    "invalid operands to compound assignment ('{}' and '{}')",
                    self.tcx.display(&ty),
                    self.tcx.display(&rhs.ty)
                ),
            );
        }
        if !rhs.ty.is_arith() && !rhs.ty.is_complex() {
            return err(loc, "invalid operand to compound assignment");
        }
        let op_ty = self.common_complex(&ty, &rhs.ty);
        let rloc = rhs.loc;
        let rhs = self.to_complex(rhs, &op_ty, rloc)?;
        self.mk(
            ExprKind::CompoundAssign {
                lhs: Box::new(lhs),
                rhs: Box::new(rhs),
                op: CompoundOp::Arith(op),
                op_ty,
            },
            ty,
            loc,
        )
    }
}

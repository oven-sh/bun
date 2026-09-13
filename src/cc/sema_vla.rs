//! Variable length arrays and label addresses.
//!
//! A `Type::Vla` names an entry of `Sema::vlas`. Its element count is evaluated once, when
//! the declaration (or type name) is reached, into a hidden local variable; `sizeof` and
//! pointer arithmetic read that variable. Array parameters of a function definition get
//! their counts at function entry; in any other parameter list they are never evaluated.

use std::rc::Rc;

use super::{Scale, Sema, VlaInfo};
use crate::ast::*;
use crate::token::{Loc, Res, err};
use crate::types::Type;

impl Sema {
    /// An array of `elem` whose length is `len`, not evaluated yet (parameter lists).
    pub(crate) fn unbound_vla(&mut self, elem: Type, len: Option<Expr>) -> Type {
        self.vlas.push(VlaInfo { len, count: None });
        Type::Vla(Rc::new(elem), (self.vlas.len() - 1) as u32)
    }

    /// An array of `elem` with `len` elements, inside a function body. Returns the type and
    /// the assignment that evaluates the length, which the caller must emit right here.
    pub(crate) fn bound_vla(&mut self, elem: Type, len: Expr, loc: Loc) -> Res<(Type, Expr)> {
        let ty = self.unbound_vla(elem, Some(len));
        let Type::Vla(_, id) = &ty else {
            return err(loc, "internal error: not a variable length array");
        };
        let evaluate = self.bind_vla(*id, loc)?;
        Ok((ty, evaluate))
    }

    /// Gives variable length array `id` its hidden count variable; returns `count = len`.
    fn bind_vla(&mut self, id: u32, loc: Loc) -> Res<Expr> {
        let size_type = self.size_type();
        let Some(len) = self.vlas.get(id as usize).and_then(|info| info.len.clone()) else {
            return err(
                loc,
                "'[*]' is only allowed in a declaration that is not a function definition",
            );
        };
        if !len.ty.is_integer() {
            return err(len.loc, "size of array has non-integer type");
        }
        let count = self.new_local(size_type.clone());
        self.vlas[id as usize].count = Some(count);
        let value = self.convert(len, &size_type, loc)?;
        let target = self.mk(ExprKind::Local(count), size_type.clone(), loc)?;
        self.mk(
            ExprKind::Assign(Box::new(target), Box::new(value)),
            size_type,
            loc,
        )
    }

    /// `count = len` for every variable length array type made since there were `first` of them
    /// that has a count variable: what evaluating the type names of an expression comes to.
    pub(crate) fn vla_bounds_since(&mut self, first: usize, loc: Loc) -> Res<Vec<Expr>> {
        let size_type = self.size_type();
        let mut out = Vec::new();
        for id in first..self.vlas.len() {
            let (Some(count), Some(len)) = (self.vlas[id].count, self.vlas[id].len.clone()) else {
                continue;
            };
            let value = self.convert(len, &size_type, loc)?;
            let target = self.mk(ExprKind::Local(count), size_type.clone(), loc)?;
            out.push(self.mk(
                ExprKind::Assign(Box::new(target), Box::new(value)),
                size_type.clone(),
                loc,
            )?);
        }
        Ok(out)
    }

    /// At the start of a function definition: evaluates the array bounds its parameter
    /// types mention (`int m[n][n]` is `int (*m)[n]`).
    pub(crate) fn bind_param_vlas(&mut self, ty: &Type, out: &mut Vec<Stmt>, loc: Loc) -> Res<()> {
        match ty {
            Type::Ptr(inner) | Type::Array(inner, _) => self.bind_param_vlas(inner, out, loc),
            Type::Vla(elem, id) => {
                self.bind_param_vlas(elem, out, loc)?;
                if self
                    .vlas
                    .get(*id as usize)
                    .is_some_and(|info| info.count.is_none())
                {
                    let evaluate = self.bind_vla(*id, loc)?;
                    out.push(Stmt::Expr(evaluate));
                }
                Ok(())
            }
            _ => Ok(()),
        }
    }

    /// `sizeof` as an expression of type `size_t`; a run-time one for variably sized types.
    pub(crate) fn size_of_expr(&self, ty: &Type, loc: Loc) -> Res<Expr> {
        let size_type = self.size_type();
        let (elem, count) = match ty {
            Type::Vla(elem, id) => {
                let Some(count) = self.vlas.get(*id as usize).and_then(|info| info.count) else {
                    return err(
                        loc,
                        "the size of this variable length array type is not known here",
                    );
                };
                (elem, self.mk(ExprKind::Local(count), size_type, loc)?)
            }
            Type::Array(elem, Some(n)) if self.tcx.is_variably_sized(elem) => {
                (elem, self.int_lit(*n as i64, size_type, loc)?)
            }
            _ => {
                return match self.tcx.size_of(ty) {
                    Some(size) => self.int_lit(size as i64, size_type, loc),
                    None => err(
                        loc,
                        format!(
                            "the size of incomplete type '{}' is needed",
                            self.tcx.display(ty)
                        ),
                    ),
                };
            }
        };
        let each = self.size_of_expr(elem, loc)?;
        self.binary(BinOp::Mul, count, each, loc)
    }

    /// The distance between consecutive elements a pointer of type `ptr_ty` points at.
    pub(crate) fn pointee_scale(&self, ptr_ty: &Type, loc: Loc) -> Res<Scale> {
        match ptr_ty.pointee() {
            Some(pointee) if self.tcx.is_variably_sized(pointee) => {
                let size = self.size_of_expr(pointee, loc)?;
                Ok(Scale::Dynamic(self.convert(size, &Type::LLong, loc)?))
            }
            _ => Ok(Scale::Const(self.pointee_size(ptr_ty, loc)?)),
        }
    }

    /// Type compatibility across declarations: variable length arrays are compatible with
    /// any array of a compatible element type.
    pub(crate) fn compatible(a: &Type, b: &Type) -> bool {
        match (a, b) {
            // An alignment given by a typedef does not make a different type.
            (Type::Qualified(p, x), _) if p.qualifiers().is_empty() => Self::compatible(x, b),
            (_, Type::Qualified(q, y)) if q.qualifiers().is_empty() => Self::compatible(a, y),
            (Type::Qualified(p, x), Type::Qualified(q, y)) => {
                p.qualifiers() == q.qualifiers() && Self::compatible(x, y)
            }
            (Type::Ptr(x), Type::Ptr(y)) => Self::compatible(x, y),
            (Type::Array(x, la), Type::Array(y, lb)) => {
                Self::compatible(x, y) && (la.is_none() || lb.is_none() || la == lb)
            }
            (Type::Vla(x, _), Type::Vla(y, _) | Type::Array(y, _))
            | (Type::Array(x, _), Type::Vla(y, _)) => Self::compatible(x, y),
            (Type::Func(f), Type::Func(g)) => {
                Self::compatible(&f.ret, &g.ret)
                    && (f.unprototyped
                        || g.unprototyped
                        || (f.variadic == g.variadic
                            && f.params.len() == g.params.len()
                            && f.params
                                .iter()
                                .zip(&g.params)
                                .all(|(p, q)| Self::compatible(p, q))))
            }
            _ => a == b,
        }
    }

    /// `&&label`: a `void *` holding a small integer that identifies the label within
    /// this function.
    pub(crate) fn label_address(&mut self, name: &Rc<str>, loc: Loc) -> Res<Expr> {
        let label = self.named_label(name, false, loc)?;
        let Some(f) = &mut self.func else {
            return err(loc, "label address outside of a function");
        };
        let position = match f.address_labels.iter().position(|&l| l == label) {
            Some(p) => p,
            None => {
                f.address_labels.push(label);
                f.address_labels.len() - 1
            }
        };
        self.int_lit(position as i64 + 1, Type::Void.ptr_to(), loc)
    }

    /// Records the variable length array scopes a label sits in, when it is defined.
    pub(crate) fn set_label_vla_path(&mut self, label: LabelId, path: &[u32]) {
        if let Some(f) = &mut self.func {
            f.label_vla_paths.insert(label, path.to_vec());
        }
    }

    pub(crate) fn new_vla_scope(&mut self) -> u32 {
        match &mut self.func {
            Some(f) => {
                f.nvla_scopes += 1;
                f.nvla_scopes
            }
            None => 0,
        }
    }
}

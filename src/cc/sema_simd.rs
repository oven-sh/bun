//! Semantic analysis of the GCC/Clang vector extensions and of C11 atomics.

use std::rc::Rc;

use super::Sema;
use crate::ast::*;
use crate::bir::{self, Lane};
use crate::constexpr::{self, Const};
use crate::token::{Loc, Res, err};
use crate::types::Type;

pub(crate) const VECTOR_SIZES: &str = "only 8-byte and 16-byte vectors are supported yet";

/// The `__ATOMIC_*` memory order values.
mod c_order {
    pub(super) const RELAXED: i64 = 0;
    pub(super) const CONSUME: i64 = 1;
    pub(super) const ACQUIRE: i64 = 2;
    pub(super) const RELEASE: i64 = 3;
    pub(super) const ACQ_REL: i64 = 4;
}

/// Which orders an operation may use; anything else is strengthened to seq_cst.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum OrderUse {
    Load,
    Store,
    ReadModifyWrite,
}

/// What an atomic read-modify-write gives back: what was there before it (`fetch_add`), or what
/// is there after (`add_fetch`).
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Yields {
    Old,
    New,
}

/// What adding to an atomic pointer counts in: bytes, as the `__atomic` builtins do, or elements,
/// as C11's `atomic_fetch_add` does.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum PointerStep {
    Bytes,
    Elements,
}

impl Sema {
    // ───────────────────────────── vector types ─────────────────────────────

    /// `__attribute__((vector_size(bytes)))` applied to `elem`.
    pub(crate) fn vector_of_bytes(&self, elem: &Type, bytes: i64, loc: Loc) -> Res<Type> {
        let esize = self.vector_elem_size(elem, loc)?;
        if bytes <= 0
            || bytes > 1 << 16
            || !(bytes as u64).is_power_of_two()
            || !(bytes as u64).is_multiple_of(esize)
        {
            return err(
                loc,
                "vector size must be a power of two that is a multiple of the element size",
            );
        }
        Ok(Type::Vector(
            Rc::new(elem.clone()),
            (bytes as u64 / esize) as u32,
        ))
    }

    /// `__attribute__((ext_vector_type(count)))` applied to `elem`.
    pub(crate) fn vector_of_count(&self, elem: &Type, count: i64, loc: Loc) -> Res<Type> {
        self.vector_elem_size(elem, loc)?;
        if count <= 0 || count > 1 << 12 {
            return err(loc, "invalid vector element count");
        }
        Ok(Type::Vector(Rc::new(elem.clone()), count as u32))
    }

    fn vector_elem_size(&self, elem: &Type, loc: Loc) -> Res<u64> {
        let usable = (elem.is_integer() && !matches!(elem, Type::Bool) && !elem.is_int128())
            || elem.is_float();
        match self.tcx.size_of(elem) {
            Some(size) if usable => Ok(size),
            _ => err(
                loc,
                format!("invalid vector element type '{}'", self.tcx.display(elem)),
            ),
        }
    }

    fn lane(&self, ty: &Type, loc: Loc) -> Res<Lane> {
        match self.tcx.lane_of(ty) {
            Some(lane) => Ok(lane),
            None => err(loc, VECTOR_SIZES),
        }
    }

    /// Same number of lanes of the same width, and both integer or both floating.
    fn same_shape(&self, a: &Type, b: &Type) -> bool {
        match (self.tcx.lane_of(a), self.tcx.lane_of(b)) {
            (Some(x), Some(y)) => x == y && self.tcx.lane_count(a) == self.tcx.lane_count(b),
            _ => false,
        }
    }

    /// The 16-byte vector operand of a builtin that is defined on whole registers.
    fn whole_register(&self, e: &Expr, name: &str, loc: Loc) -> Res<Lane> {
        if self.tcx.size_of(&e.ty) != Some(16) {
            return err(
                loc,
                format!("{name} has an operand of the wrong vector type"),
            );
        }
        self.lane(&e.ty, loc)
    }

    fn elem_zero(&self, elem: &Type, loc: Loc) -> Res<Expr> {
        if elem.is_float() {
            self.float_lit(0.0, elem.clone(), loc)
        } else {
            self.int_lit(0, elem.clone(), loc)
        }
    }

    pub(crate) fn vec_zero(&self, ty: &Type, loc: Loc) -> Res<Expr> {
        let Some(elem) = ty.vector_elem() else {
            return err(loc, "internal error: zero of a non-vector type");
        };
        let zero = self.elem_zero(elem, loc)?;
        self.mk(ExprKind::VecSplat(Box::new(zero)), ty.clone(), loc)
    }

    /// Scalar `e` converted to the element type of `ty` and copied into every lane.
    fn splat(&self, e: Expr, ty: &Type, loc: Loc) -> Res<Expr> {
        let Some(elem) = ty.vector_elem() else {
            return err(loc, "internal error: splat to a non-vector type");
        };
        if !e.ty.is_arith() {
            return err(
                loc,
                format!(
                    "cannot convert '{}' to the vector type '{}'",
                    self.tcx.display(&e.ty),
                    self.tcx.display(ty)
                ),
            );
        }
        let converted = self.convert(e, elem, loc)?;
        self.mk(ExprKind::VecSplat(Box::new(converted)), ty.clone(), loc)
    }

    /// Reinterprets vector `e` as the equally sized vector type `to`.
    fn vec_bitcast(&self, e: Expr, to: &Type, loc: Loc) -> Res<Expr> {
        if e.ty == *to {
            return Ok(e);
        }
        self.mk(ExprKind::Cast(Box::new(e)), to.clone(), loc)
    }

    /// An explicit cast involving a vector type: equally sized vectors reinterpret.
    pub(crate) fn vec_cast(&self, e: Expr, to: &Type, loc: Loc) -> Res<Expr> {
        let sizes = (self.tcx.size_of(&e.ty), self.tcx.size_of(to));
        if e.ty.is_vector() && to.is_vector() && sizes.0 == sizes.1 {
            return self.vec_bitcast(e, to, loc);
        }
        // An 8-byte vector and a 64-bit integer are the same bits.
        let bits = |vector: &Type, scalar: &Type| {
            self.tcx.is_half_vector(vector) && scalar.is_integer() && !scalar.is_int128()
        };
        if sizes.0 == sizes.1 && (bits(&e.ty, to) || bits(to, &e.ty)) {
            return self.mk(ExprKind::Cast(Box::new(e)), to.clone(), loc);
        }
        err(
            loc,
            format!(
                "cannot cast '{}' to '{}'",
                self.tcx.display(&e.ty),
                self.tcx.display(to)
            ),
        )
    }

    /// Conversion as if by assignment to vector type `to`: the source must be a vector of
    /// the same shape (element signedness may differ).
    pub(crate) fn vec_assign_convert(&self, e: Expr, to: &Type, loc: Loc, what: &str) -> Res<Expr> {
        if e.ty.is_vector() && (e.ty == *to || self.same_shape(&e.ty, to)) {
            return self.vec_bitcast(e, to, loc);
        }
        err(
            loc,
            format!(
                "incompatible types when {what}: cannot convert '{}' to '{}'",
                self.tcx.display(&e.ty),
                self.tcx.display(to)
            ),
        )
    }

    /// Brings the operands of a lane-wise operation to one vector type.
    fn vec_operands(&self, a: Expr, b: Expr, what: &str, loc: Loc) -> Res<(Expr, Expr)> {
        let ty = if a.ty.is_vector() {
            a.ty.clone()
        } else {
            b.ty.clone()
        };
        self.lane(&ty, loc)?;
        let a = if a.ty.is_vector() {
            a
        } else {
            self.splat(a, &ty, loc)?
        };
        let b = if b.ty.is_vector() {
            b
        } else {
            self.splat(b, &ty, loc)?
        };
        if a.ty != b.ty && !self.same_shape(&a.ty, &b.ty) {
            return err(
                loc,
                format!(
                    "invalid operands to {what} ('{}' and '{}')",
                    self.tcx.display(&a.ty),
                    self.tcx.display(&b.ty)
                ),
            );
        }
        let b = self.vec_bitcast(b, &ty, loc)?;
        Ok((a, b))
    }

    fn is_int_vector(&self, ty: &Type) -> bool {
        ty.vector_elem().is_some_and(Type::is_integer)
    }

    pub(crate) fn vec_binary(
        &self,
        op: BinOp,
        a: Expr,
        b: Expr,
        spelling: &str,
        loc: Loc,
    ) -> Res<Expr> {
        let what = format!("binary {spelling}");
        if matches!(op, BinOp::Shl | BinOp::Shr) {
            // `scalar << vector` shifts a splat of the scalar.
            let a = if a.ty.is_vector() {
                a
            } else {
                self.splat(a, &b.ty, loc)?
            };
            self.lane(&a.ty, loc)?;
            let amount_ok =
                b.ty.is_integer() || (self.is_int_vector(&b.ty) && self.same_shape(&a.ty, &b.ty));
            if !self.is_int_vector(&a.ty) || !amount_ok {
                return self.bad_operands(spelling, &a, &b, loc);
            }
            let b = if b.ty.is_vector() {
                b
            } else {
                let bloc = b.loc;
                self.convert(b, &Type::Int, bloc)?
            };
            let ty = a.ty.clone();
            return self.mk(ExprKind::Binary(op, Box::new(a), Box::new(b)), ty, loc);
        }
        let (a, b) = self.vec_operands(a, b, &what, loc)?;
        let int_only = matches!(op, BinOp::Rem | BinOp::And | BinOp::Or | BinOp::Xor);
        if int_only && !self.is_int_vector(&a.ty) {
            return self.bad_operands(spelling, &a, &b, loc);
        }
        let ty = if op.is_compare() {
            self.tcx.mask_vector_of(&a.ty)
        } else {
            a.ty.clone()
        };
        self.mk(ExprKind::Binary(op, Box::new(a), Box::new(b)), ty, loc)
    }

    pub(crate) fn vec_neg(&self, e: Expr, loc: Loc) -> Res<Expr> {
        self.lane(&e.ty, loc)?;
        let ty = e.ty.clone();
        self.mk(ExprKind::Neg(Box::new(e)), ty, loc)
    }

    pub(crate) fn vec_bit_not(&self, e: Expr, loc: Loc) -> Res<Expr> {
        self.lane(&e.ty, loc)?;
        if !self.is_int_vector(&e.ty) {
            return err(
                loc,
                format!("invalid operand to unary ~ ('{}')", self.tcx.display(&e.ty)),
            );
        }
        let ty = e.ty.clone();
        self.mk(ExprKind::BitNot(Box::new(e)), ty, loc)
    }

    /// Lane-wise `e != 0` (or `e == 0`): all ones where it holds.
    fn vec_truth(&self, e: Expr, negate: bool, loc: Loc) -> Res<Expr> {
        let zero = self.vec_zero(&e.ty, loc)?;
        let (op, spelling) = if negate {
            (BinOp::Eq, "==")
        } else {
            (BinOp::Ne, "!=")
        };
        self.vec_binary(op, e, zero, spelling, loc)
    }

    pub(crate) fn vec_log_not(&self, e: Expr, loc: Loc) -> Res<Expr> {
        self.vec_truth(e, true, loc)
    }

    /// Lane-wise `&&` / `||`; both operands are always evaluated.
    pub(crate) fn vec_logical(&self, is_and: bool, a: Expr, b: Expr, loc: Loc) -> Res<Expr> {
        let spelling = if is_and { "&&" } else { "||" };
        let (a, b) = self.vec_operands(a, b, spelling, loc)?;
        let a = self.vec_truth(a, false, loc)?;
        let b = self.vec_truth(b, false, loc)?;
        self.vec_binary(
            if is_and { BinOp::And } else { BinOp::Or },
            a,
            b,
            spelling,
            loc,
        )
    }

    /// Whether every lane of `e` is known to be all ones or all zeros.
    fn is_lane_mask(e: &Expr) -> bool {
        if e.depth > TALLEST_ANALYSED {
            return false;
        }
        match &e.kind {
            ExprKind::Binary(op, a, b) => {
                op.is_compare()
                    || (matches!(op, BinOp::And | BinOp::Or | BinOp::Xor)
                        && Self::is_lane_mask(a)
                        && Self::is_lane_mask(b))
            }
            ExprKind::BitNot(a) | ExprKind::Cast(a) => a.ty.is_vector() && Self::is_lane_mask(a),
            _ => false,
        }
    }

    /// `mask ? a : b` with a vector condition: each lane of the result comes from `a` where
    /// the lane of `mask` is non-zero.
    pub(crate) fn vec_select(&self, mask: Expr, a: Expr, b: Expr, loc: Loc) -> Res<Expr> {
        self.lane(&mask.ty, loc)?;
        if !self.is_int_vector(&mask.ty) {
            return err(loc, "a vector condition must have an integer vector type");
        }
        let (a, b) = if a.ty.is_vector() || b.ty.is_vector() {
            self.vec_operands(a, b, "'?:'", loc)?
        } else {
            // Two scalars take the shape of the condition.
            (self.splat(a, &mask.ty, loc)?, self.splat(b, &mask.ty, loc)?)
        };
        self.lane(&a.ty, loc)?;
        if self.tcx.lane_count(&mask.ty) != self.tcx.lane_count(&a.ty)
            || self.tcx.size_of(&mask.ty) != self.tcx.size_of(&a.ty)
        {
            return err(
                loc,
                "the vector condition and the operands of '?:' must have the same number of elements",
            );
        }
        let mask = if Self::is_lane_mask(&mask) {
            mask
        } else {
            self.vec_truth(mask, false, loc)?
        };
        let ty = a.ty.clone();
        self.mk(
            ExprKind::VecBuiltin(VecBuiltin::Select, vec![mask, a, b]),
            ty,
            loc,
        )
    }

    /// `v[i]`.
    pub(crate) fn vec_index(&mut self, base: Expr, index: Expr, loc: Loc) -> Res<Expr> {
        self.lane(&base.ty, loc)?;
        if !index.ty.is_integer() {
            return err(loc, "vector subscript is not an integer");
        }
        let Some(elem) = base.ty.vector_elem().cloned() else {
            return err(loc, "internal error: subscript of a non-vector");
        };
        let iloc = index.loc;
        let index = self.convert(index, &Type::Int, iloc)?;
        // A lane picked at run time is read from (or written to) the vector in memory.
        if !matches!(index.kind, ExprKind::IntLit(_)) {
            self.mark_addr_taken(&base);
        }
        self.mk(
            ExprKind::VecElem(Box::new(base), Box::new(index)),
            elem,
            loc,
        )
    }

    /// `{ a, b, ... }` for a vector: missing lanes are zero.
    pub(crate) fn vec_from_list(&self, ty: &Type, items: Vec<Expr>, loc: Loc) -> Res<Expr> {
        let Type::Vector(elem, count) = ty else {
            return err(loc, "internal error: vector initializer for a non-vector");
        };
        if items.len() > *count as usize {
            return err(loc, "excess elements in vector initializer");
        }
        let mut lanes = Vec::with_capacity(*count as usize);
        for item in items {
            let iloc = item.loc;
            lanes.push(self.assign_convert(item, elem, iloc, "initializing")?);
        }
        while lanes.len() < *count as usize {
            lanes.push(self.elem_zero(elem, loc)?);
        }
        self.mk(ExprKind::VecInit(lanes), ty.clone(), loc)
    }

    /// The 16 bytes of a vector expression whose lanes are all constants.
    pub(crate) fn const_vector_bytes(&self, e: &Expr) -> Option<[u8; 16]> {
        vector_bytes(e, &self.tcx)
    }

    // ───────────────────────────── vector builtins ─────────────────────────────

    fn vector_arg(&self, e: Expr, name: &str) -> Res<Expr> {
        let e = self.rvalue(e)?;
        if !e.ty.is_vector() {
            return err(e.loc, format!("{name} needs a vector operand"));
        }
        self.lane(&e.ty, e.loc)?;
        Ok(e)
    }

    /// Byte indices that pick whole lanes: `lanes[i]` indexes the `2 * count` lanes of `a:b`,
    /// each of which has `count` lanes of `lane`'s width at the start of its 16 bytes.
    fn lane_shuffle_bytes(lane: Lane, count: u32, lanes: &[u32]) -> [u8; 16] {
        let width = 16 / u32::from(lane.count());
        let mut bytes = [0u8; 16];
        for (i, &pick) in lanes.iter().enumerate().take(lane.count() as usize) {
            let start = if pick < count {
                pick * width
            } else {
                16 + (pick - count) * width
            };
            for k in 0..width {
                bytes[i * width as usize + k as usize] = (start + k) as u8;
            }
        }
        bytes
    }

    /// `__builtin_shufflevector(a, b, i0, i1, ...)`.
    pub(crate) fn shufflevector(&self, mut args: Vec<Expr>, loc: Loc) -> Res<Expr> {
        if args.len() < 3 {
            return err(
                loc,
                "__builtin_shufflevector takes two vectors and the result's lane indices",
            );
        }
        let indices = args.split_off(2);
        let b = self.vector_arg(args.swap_remove(1), "__builtin_shufflevector")?;
        let a = self.vector_arg(args.swap_remove(0), "__builtin_shufflevector")?;
        let (a, b) = self.vec_operands(a, b, "__builtin_shufflevector", loc)?;
        let lane = self.lane(&a.ty, loc)?;
        let count = self.tcx.lane_count(&a.ty);
        // The result has as many lanes as there are indices: half a vector, or two of them.
        let Type::Vector(elem, _) = &a.ty else {
            return err(loc, "internal error: shuffle of a non-vector");
        };
        let ty = Type::Vector(Rc::clone(elem), indices.len() as u32);
        if !matches!(self.tcx.size_of(&ty), Some(8 | 16)) {
            return err(loc, VECTOR_SIZES);
        }
        let mut lanes = Vec::with_capacity(indices.len());
        for index in &indices {
            let value = match self.const_int(index) {
                Ok(v) => v,
                Err(_) => return err(index.loc, "shuffle index must be a constant integer"),
            };
            if value < -1 || value >= i64::from(count) * 2 {
                return err(index.loc, "shuffle index is out of range");
            }
            // -1 is "don't care".
            lanes.push(value.max(0) as u32);
        }
        let bytes = Self::lane_shuffle_bytes(lane, count, &lanes);
        self.mk(
            ExprKind::VecBuiltin(VecBuiltin::Shuffle(bytes), vec![a, b]),
            ty,
            loc,
        )
    }

    /// `__builtin_shuffle(a, mask)` and `__builtin_shuffle(a, b, mask)`.
    pub(crate) fn gnu_shuffle(&self, mut args: Vec<Expr>, loc: Loc) -> Res<Expr> {
        if args.len() != 2 && args.len() != 3 {
            return err(loc, "__builtin_shuffle takes two or three arguments");
        }
        let two_inputs = args.len() == 3;
        let mask = self.vector_arg(args.swap_remove(args.len() - 1), "__builtin_shuffle")?;
        let a = self.vector_arg(args.swap_remove(0), "__builtin_shuffle")?;
        let b = match args.pop() {
            Some(b) => self.vector_arg(b, "__builtin_shuffle")?,
            None => a.clone(),
        };
        let (a, b) = self.vec_operands(a, b, "__builtin_shuffle", loc)?;
        let lane = self.lane(&a.ty, loc)?;
        self.lane(&mask.ty, loc)?;
        if !self.is_int_vector(&mask.ty)
            || self.tcx.lane_count(&mask.ty) != self.tcx.lane_count(&a.ty)
            || self.tcx.size_of(&mask.ty) != self.tcx.size_of(&a.ty)
        {
            return err(
                loc,
                "the mask of __builtin_shuffle must be an integer vector with as many elements as the operands",
            );
        }
        let count = u64::from(self.tcx.lane_count(&a.ty));
        let modulus = if two_inputs { count * 2 } else { count };
        let ty = a.ty.clone();
        if let Some(bytes) = self.const_vector_bytes(&mask) {
            let width = 16 / lane.count() as usize;
            let mut lanes = Vec::with_capacity(count as usize);
            for i in 0..count as usize {
                let mut raw = [0u8; 8];
                raw[..width].copy_from_slice(&bytes[i * width..(i + 1) * width]);
                lanes.push((u64::from_le_bytes(raw) % modulus) as u32);
            }
            let bytes = Self::lane_shuffle_bytes(lane, count as u32, &lanes);
            return self.mk(
                ExprKind::VecBuiltin(VecBuiltin::Shuffle(bytes), vec![a, b]),
                ty,
                loc,
            );
        }
        let kind = VecBuiltin::ShuffleDynamic { two_inputs };
        self.mk(ExprKind::VecBuiltin(kind, vec![a, b, mask]), ty, loc)
    }

    /// `__builtin_convertvector(v, type)`.
    pub(crate) fn convertvector(&self, v: Expr, to: &Type, loc: Loc) -> Res<Expr> {
        let v = self.vector_arg(v, "__builtin_convertvector")?;
        let (Type::Vector(_, from_count), Type::Vector(_, to_count)) = (&v.ty, to) else {
            return err(loc, "__builtin_convertvector converts to a vector type");
        };
        if from_count != to_count {
            return err(
                loc,
                "__builtin_convertvector needs vectors with the same number of elements",
            );
        }
        self.lane(to, loc)?;
        self.mk(
            ExprKind::VecBuiltin(VecBuiltin::Convert, vec![v]),
            to.clone(),
            loc,
        )
    }

    /// `__builtin_elementwise_{abs,min,max,sqrt}`.
    pub(crate) fn elementwise(
        &self,
        op: VecBuiltin,
        name: &str,
        mut args: Vec<Expr>,
        loc: Loc,
    ) -> Res<Expr> {
        let ieee = matches!(op, VecBuiltin::Minimum | VecBuiltin::Maximum);
        let arity = if ieee || matches!(op, VecBuiltin::Min | VecBuiltin::Max) {
            2
        } else {
            1
        };
        if args.len() != arity {
            return err(loc, format!("{name} takes {arity} argument(s)"));
        }
        // Of two `float`s or two `double`s as well (Clang takes scalars everywhere here; these
        // two are the ones there is an instruction for).
        if ieee && !args.iter().any(|arg| arg.ty.is_vector()) {
            let b = self.rvalue(args.swap_remove(1))?;
            let a = self.rvalue(args.swap_remove(0))?;
            if !a.ty.is_float() || a.ty != b.ty {
                return err(
                    loc,
                    format!("{name} needs two operands of one floating-point type"),
                );
            }
            let (ty, which) = (
                a.ty.clone(),
                if op == VecBuiltin::Minimum {
                    Intrinsic::FMinimum
                } else {
                    Intrinsic::FMaximum
                },
            );
            return self.mk(ExprKind::Intrinsic(which, vec![a, b]), ty, loc);
        }
        let a = self.vector_arg(args.swap_remove(0), name)?;
        if (ieee || op == VecBuiltin::Sqrt) && self.is_int_vector(&a.ty) {
            return err(loc, format!("{name} needs a floating-point vector"));
        }
        let ty = a.ty.clone();
        let operands = match args.pop() {
            Some(b) => {
                let b = self.rvalue(b)?;
                let (a, b) = self.vec_operands(a, b, name, loc)?;
                vec![a, b]
            }
            None => vec![a],
        };
        self.mk(ExprKind::VecBuiltin(op, operands), ty, loc)
    }

    /// `__builtin_reduce_{add,mul,min,max,and,or,xor}`.
    pub(crate) fn reduce(
        &self,
        op: ReduceOp,
        name: &str,
        mut args: Vec<Expr>,
        loc: Loc,
    ) -> Res<Expr> {
        if args.len() != 1 {
            return err(loc, format!("{name} takes one argument"));
        }
        let v = self.vector_arg(args.swap_remove(0), name)?;
        let bitwise = matches!(op, ReduceOp::And | ReduceOp::Or | ReduceOp::Xor);
        if bitwise && !self.is_int_vector(&v.ty) {
            return err(loc, format!("{name} needs an integer vector"));
        }
        if matches!(op, ReduceOp::Minimum | ReduceOp::Maximum) && self.is_int_vector(&v.ty) {
            return err(loc, format!("{name} needs a floating-point vector"));
        }
        let Some(elem) = v.ty.vector_elem().cloned() else {
            return err(loc, "internal error: reduction of a non-vector");
        };
        self.mk(
            ExprKind::VecBuiltin(VecBuiltin::Reduce(op), vec![v]),
            elem,
            loc,
        )
    }

    /// The x86 `movmsk` family: `lane` is the shape the builtin is defined on.
    pub(crate) fn movemask(
        &self,
        lane: Lane,
        name: &str,
        mut args: Vec<Expr>,
        loc: Loc,
    ) -> Res<Expr> {
        if args.len() != 1 {
            return err(loc, format!("{name} takes one argument"));
        }
        let v = self.vector_arg(args.swap_remove(0), name)?;
        if self.whole_register(&v, name, loc)?.count() != lane.count() {
            return err(
                loc,
                format!("{name} has an operand of the wrong vector type"),
            );
        }
        self.mk(
            ExprKind::VecBuiltin(VecBuiltin::Bitmask, vec![v]),
            Type::Int,
            loc,
        )
    }

    /// `__builtin_ia32_ptestz128(a, b)`: 1 if `a & b` is all zeros.
    pub(crate) fn test_zero(&self, name: &str, mut args: Vec<Expr>, loc: Loc) -> Res<Expr> {
        if args.len() != 2 {
            return err(loc, format!("{name} takes two arguments"));
        }
        let b = self.vector_arg(args.swap_remove(1), name)?;
        let a = self.vector_arg(args.swap_remove(0), name)?;
        self.mk(
            ExprKind::VecBuiltin(VecBuiltin::TestZero, vec![a, b]),
            Type::Int,
            loc,
        )
    }

    /// A two-operand builtin on whole 128-bit vectors whose operands must have `lane`
    /// shape (any signedness) and whose result has type `to`. The ones that only look at
    /// the lanes they produce also take 8-byte vectors, as the low half of zeros.
    pub(crate) fn lane_builtin(
        &self,
        op: VecBuiltin,
        lane: Lane,
        to: Option<Type>,
        name: &str,
        mut args: Vec<Expr>,
        loc: Loc,
    ) -> Res<Expr> {
        if args.len() != 2 {
            return err(loc, format!("{name} takes two arguments"));
        }
        let b = self.vector_arg(args.swap_remove(1), name)?;
        let a = self.vector_arg(args.swap_remove(0), name)?;
        let low_half_too = matches!(
            op,
            VecBuiltin::Swizzle
                | VecBuiltin::AverageUnsigned
                | VecBuiltin::ExtMul { high: false, .. }
        ) && self.tcx.size_of(&a.ty) == self.tcx.size_of(&b.ty);
        for operand in [&a, &b] {
            let shape = if low_half_too {
                self.lane(&operand.ty, loc)?
            } else {
                self.whole_register(operand, name, loc)?
            };
            if shape.count() != lane.count() || shape.is_float() {
                return err(
                    loc,
                    format!("{name} has an operand of the wrong vector type"),
                );
            }
        }
        let ty = to.unwrap_or_else(|| a.ty.clone());
        self.mk(ExprKind::VecBuiltin(op, vec![a, b]), ty, loc)
    }

    /// `__builtin_elementwise_add_sat` / `__builtin_elementwise_sub_sat`.
    pub(crate) fn elementwise_saturating(
        &self,
        add: bool,
        name: &str,
        mut args: Vec<Expr>,
        loc: Loc,
    ) -> Res<Expr> {
        if args.len() != 2 {
            return err(loc, format!("{name} takes two arguments"));
        }
        let b = self.rvalue(args.swap_remove(1))?;
        let a = self.vector_arg(args.swap_remove(0), name)?;
        let (a, b) = self.vec_operands(a, b, name, loc)?;
        let lane = self.lane(&a.ty, loc)?;
        if !matches!(lane, Lane::I8x16 | Lane::I16x8) {
            return err(loc, format!("{name} needs 8- or 16-bit integer lanes"));
        }
        let signed = a.ty.vector_elem().is_some_and(|e| self.tcx.is_signed(e));
        let op = if add {
            VecBuiltin::AddSat { signed }
        } else {
            VecBuiltin::SubSat { signed }
        };
        let ty = a.ty.clone();
        self.mk(ExprKind::VecBuiltin(op, vec![a, b]), ty, loc)
    }

    /// A lane conversion named by a BIR `VConvertKind`, behind the x86 builtins for the
    /// widening and narrowing conversions.
    pub(crate) fn convert_kind(
        &self,
        kind: u8,
        to: Type,
        name: &str,
        mut args: Vec<Expr>,
        loc: Loc,
    ) -> Res<Expr> {
        if args.len() != 1 || kind >= bir::VCONVERT_KINDS {
            return err(loc, format!("{name} takes one argument"));
        }
        let v = self.vector_arg(args.swap_remove(0), name)?;
        self.mk(
            ExprKind::VecBuiltin(VecBuiltin::ConvertKind(kind), vec![v]),
            to,
            loc,
        )
    }

    // ───────────────────────────── atomics ─────────────────────────────

    /// `_Atomic` applied to `ty`.
    pub(crate) fn atomic_of(&self, ty: Type, loc: Loc) -> Res<Type> {
        if ty.is_atomic() {
            return Ok(ty);
        }
        // (A 16-byte integer can be declared atomic; operating on one is the error, where
        // such an operation is compiled: see `atomic_address`.)
        let supported = (ty.is_scalar()
            && matches!(self.tcx.size_of(&ty), Some(1 | 2 | 4 | 8 | 16)))
            && !ty.is_func()
            && !ty.is_complex();
        if !supported {
            return err(
                loc,
                format!(
                    "_Atomic '{}' is not supported yet (only integer, pointer, float and double types of up to 8 bytes)",
                    self.tcx.display(&ty)
                ),
            );
        }
        Ok(Type::Atomic(Rc::new(ty)))
    }

    fn mk_atomic(&self, atomic: AtomicExpr, ty: Type, loc: Loc) -> Res<Expr> {
        // Compare-and-swap loops and the `expected` write-back create blocks.
        let addr = match &atomic {
            AtomicExpr::Load { addr, .. }
            | AtomicExpr::Store { addr, .. }
            | AtomicExpr::Rmw { addr, .. }
            | AtomicExpr::Cas { addr, .. } => Some(addr),
            AtomicExpr::Fence(_) => None,
        };
        if let Some(object) = addr.and_then(|a| a.ty.pointee()).map(Type::unatomic) {
            if self.tcx.size_of(object) == Some(16) {
                let message = format!(
                    "an atomic operation on an object of type '{}' is not supported: there are no 16-byte atomic operations",
                    self.tcx.display(object)
                );
                return self.mk(ExprKind::Unsupported(Rc::from(message)), ty, loc);
            }
        }
        let branches = matches!(atomic, AtomicExpr::Rmw { .. } | AtomicExpr::Cas { .. });
        let mut e = self.mk(ExprKind::Atomic(Box::new(atomic)), ty, loc)?;
        e.has_control_flow |= branches;
        Ok(e)
    }

    /// The address of an `_Atomic` lvalue. Atomic locals always live in memory.
    fn atomic_address(&self, lvalue: Expr) -> Res<Expr> {
        let loc = lvalue.loc;
        let lvalue = match lvalue.unwrap_kind(|kind| match kind {
            ExprKind::Deref(inner) => Ok(*inner),
            other => Err(other),
        }) {
            Ok(address) => return Ok(address),
            Err(lvalue) => lvalue,
        };
        let ty = lvalue.ty.clone().ptr_to();
        self.mk(ExprKind::AddrOf(Box::new(lvalue)), ty, loc)
    }

    /// Reading an `_Atomic` lvalue: a sequentially consistent load.
    pub(crate) fn atomic_read(&self, lvalue: Expr) -> Res<Expr> {
        let loc = lvalue.loc;
        let ty = lvalue.ty.unatomic().clone();
        let addr = self.atomic_address(lvalue)?;
        self.mk_atomic(
            AtomicExpr::Load {
                addr,
                order: bir::order::SEQ_CST,
            },
            ty,
            loc,
        )
    }

    /// `lhs = rhs` for an `_Atomic` lvalue.
    pub(crate) fn atomic_assign(&self, lhs: Expr, rhs: Expr, loc: Loc) -> Res<Expr> {
        let ty = lhs.ty.unatomic().clone();
        let value = self.assign_convert(rhs, &ty, loc, "assigning")?;
        let addr = self.atomic_address(lhs)?;
        self.mk_atomic(
            AtomicExpr::Store {
                addr,
                value,
                order: bir::order::SEQ_CST,
            },
            ty,
            loc,
        )
    }

    /// `lhs op= rhs` for an `_Atomic` lvalue; evaluates to the new value.
    pub(crate) fn atomic_compound_assign(
        &self,
        op: BinOp,
        lhs: Expr,
        rhs: Expr,
        loc: Loc,
    ) -> Res<Expr> {
        let ty = lhs.ty.unatomic().clone();
        let rhs = self.rvalue(rhs)?;
        let (rmw, value, op_ty) = if ty.is_ptr() {
            if !matches!(op, BinOp::Add | BinOp::Sub) || !rhs.ty.is_integer() {
                return err(loc, "invalid operands to compound assignment on a pointer");
            }
            let scale = self.pointee_size(&ty, loc)?;
            let rloc = rhs.loc;
            let value = self.convert(rhs, &Type::LLong, rloc)?;
            (
                RmwOp::PtrAdd {
                    scale,
                    sub: op == BinOp::Sub,
                },
                value,
                ty.clone(),
            )
        } else {
            let (op_ty, value) = self.compound_operands(op, &ty, rhs, loc)?;
            (RmwOp::Arith(op), value, op_ty)
        };
        let addr = self.atomic_address(lhs)?;
        let atomic = AtomicExpr::Rmw {
            addr,
            value,
            op: rmw,
            op_ty,
            order: bir::order::SEQ_CST,
            want_new: true,
        };
        self.mk_atomic(atomic, ty, loc)
    }

    /// `++`/`--` on an `_Atomic` lvalue.
    pub(crate) fn atomic_inc_dec(
        &self,
        lhs: Expr,
        step: super::Step,
        fix: super::Fix,
        loc: Loc,
    ) -> Res<Expr> {
        let (inc, post) = (step == super::Step::Up, fix == super::Fix::Postfix);
        let ty = lhs.ty.unatomic().clone();
        let (op, value, op_ty) = if ty.is_ptr() {
            let scale = self.pointee_size(&ty, loc)?;
            (
                RmwOp::PtrAdd { scale, sub: !inc },
                self.int_lit(1, Type::LLong, loc)?,
                ty.clone(),
            )
        } else if ty.is_arith() {
            let op_ty = Self::promoted_type(&ty);
            let one = if op_ty.is_float() {
                self.float_lit(1.0, op_ty.clone(), loc)?
            } else {
                self.int_lit(1, op_ty.clone(), loc)?
            };
            (
                RmwOp::Arith(if inc { BinOp::Add } else { BinOp::Sub }),
                one,
                op_ty,
            )
        } else {
            return err(
                loc,
                format!(
                    "cannot increment a value of type '{}'",
                    self.tcx.display(&ty)
                ),
            );
        };
        let addr = self.atomic_address(lhs)?;
        let atomic = AtomicExpr::Rmw {
            addr,
            value,
            op,
            op_ty,
            order: bir::order::SEQ_CST,
            want_new: !post,
        };
        self.mk_atomic(atomic, ty, loc)
    }

    /// The BIR memory order for a C `memory_order` operand; one that is not a constant is
    /// sequentially consistent.
    pub(crate) fn memory_order(&self, e: &Expr, usage: OrderUse) -> u8 {
        use bir::order::*;
        let Ok(value) = self.const_int(e) else {
            return SEQ_CST;
        };
        let order = match value {
            c_order::RELAXED => RELAXED,
            c_order::CONSUME | c_order::ACQUIRE => ACQUIRE,
            c_order::RELEASE => RELEASE,
            c_order::ACQ_REL => ACQ_REL,
            _ => SEQ_CST,
        };
        let valid = match usage {
            OrderUse::Load => matches!(order, RELAXED | ACQUIRE),
            OrderUse::Store => matches!(order, RELAXED | RELEASE),
            OrderUse::ReadModifyWrite => true,
        };
        if valid { order } else { SEQ_CST }
    }

    /// Checks the pointer operand of an atomic builtin. Returns the pointer and the
    /// (non-atomic) type of the object it points to.
    fn atomic_pointer(&self, ptr: Expr, name: &str) -> Res<(Expr, Type)> {
        let ptr = self.rvalue(ptr)?;
        let Some(pointee) = ptr.ty.pointee() else {
            return err(
                ptr.loc,
                format!("the first argument of {name} must be a pointer"),
            );
        };
        let object = pointee.unatomic().clone();
        let supported =
            object.is_scalar() && matches!(self.tcx.size_of(&object), Some(1 | 2 | 4 | 8));
        if !supported {
            return err(
                ptr.loc,
                format!(
                    "{name} on an object of type '{}' is not supported yet (only integer, pointer, float and double types of up to 8 bytes)",
                    self.tcx.display(&object)
                ),
            );
        }
        Ok((ptr, object))
    }

    /// Keeps the side effects of operands that did not become part of the operation.
    fn after(&self, extras: Vec<Expr>, e: Expr, loc: Loc) -> Res<Expr> {
        let mut result = e;
        for extra in extras.into_iter().rev() {
            if !matches!(extra.kind, ExprKind::IntLit(_)) {
                let ty = result.ty.clone();
                result = self.mk(ExprKind::Comma(Box::new(extra), Box::new(result)), ty, loc)?;
            }
        }
        Ok(result)
    }

    fn void_of(&self, e: Expr, loc: Loc) -> Res<Expr> {
        self.mk(ExprKind::Cast(Box::new(e)), Type::Void, loc)
    }

    /// `__atomic_load_n(ptr, order)`.
    pub(crate) fn atomic_load_n(&self, name: &str, mut args: Vec<Expr>, loc: Loc) -> Res<Expr> {
        if args.len() != 2 {
            return err(loc, format!("{name} takes two arguments"));
        }
        let order_expr = args.swap_remove(1);
        let order = self.memory_order(&order_expr, OrderUse::Load);
        let (addr, object) = self.atomic_pointer(args.swap_remove(0), name)?;
        let e = self.mk_atomic(AtomicExpr::Load { addr, order }, object, loc)?;
        self.after(vec![order_expr], e, loc)
    }

    /// `__atomic_store_n(ptr, value, order)`.
    pub(crate) fn atomic_store_n(&self, name: &str, mut args: Vec<Expr>, loc: Loc) -> Res<Expr> {
        if args.len() != 3 {
            return err(loc, format!("{name} takes three arguments"));
        }
        let order_expr = args.swap_remove(2);
        let order = self.memory_order(&order_expr, OrderUse::Store);
        let value = args.swap_remove(1);
        let (addr, object) = self.atomic_pointer(args.swap_remove(0), name)?;
        let value = self.assign_convert(value, &object, loc, "passing an argument")?;
        let store = self.mk_atomic(AtomicExpr::Store { addr, value, order }, object, loc)?;
        let e = self.void_of(store, loc)?;
        self.after(vec![order_expr], e, loc)
    }

    /// `__atomic_exchange_n`, `__atomic_fetch_OP` and `__atomic_OP_fetch`: `(ptr, value, order)`.
    pub(crate) fn atomic_rmw(
        &self,
        name: &str,
        op: RmwOp,
        yields: Yields,
        step: PointerStep,
        mut args: Vec<Expr>,
        loc: Loc,
    ) -> Res<Expr> {
        if args.len() != 3 {
            return err(loc, format!("{name} takes three arguments"));
        }
        let order_expr = args.swap_remove(2);
        let order = self.memory_order(&order_expr, OrderUse::ReadModifyWrite);
        let value = args.swap_remove(1);
        let (addr, object) = self.atomic_pointer(args.swap_remove(0), name)?;
        let e = self.rmw_node(name, op, yields, step, addr, object, value, order, loc)?;
        self.after(vec![order_expr], e, loc)
    }

    fn rmw_node(
        &self,
        name: &str,
        op: RmwOp,
        yields: Yields,
        step: PointerStep,
        addr: Expr,
        object: Type,
        value: Expr,
        order: u8,
        loc: Loc,
    ) -> Res<Expr> {
        let (op, value, op_ty) = match op {
            RmwOp::Exchange => (
                op,
                self.assign_convert(value, &object, loc, "passing an argument")?,
                object.clone(),
            ),
            RmwOp::Arith(BinOp::Add | BinOp::Sub) if object.is_ptr() => {
                let value = self.rvalue(value)?;
                if !value.ty.is_integer() {
                    return err(loc, format!("{name} on a pointer needs an integer operand"));
                }
                let scale = match step {
                    PointerStep::Elements => self.pointee_size(&object, loc)?,
                    PointerStep::Bytes => 1,
                };
                let sub = matches!(op, RmwOp::Arith(BinOp::Sub));
                let vloc = value.loc;
                (
                    RmwOp::PtrAdd { scale, sub },
                    self.convert(value, &Type::LLong, vloc)?,
                    object.clone(),
                )
            }
            _ => {
                if !object.is_integer() && !object.is_ptr() {
                    return err(
                        loc,
                        format!(
                            "{name} needs a pointer to an integer, got '{}'",
                            self.tcx.display(&object)
                        ),
                    );
                }
                // Bitwise operations on an atomic pointer work on its address.
                let op_ty = if object.is_ptr() {
                    Type::ULLong
                } else {
                    object.clone()
                };
                let value = self.rvalue(value)?;
                if !value.ty.is_scalar() || value.ty.is_float() {
                    return err(loc, format!("{name} needs an integer operand"));
                }
                (op, self.convert(value, &op_ty, loc)?, op_ty)
            }
        };
        let atomic = AtomicExpr::Rmw {
            addr,
            value,
            op,
            op_ty,
            order,
            want_new: yields == Yields::New,
        };
        self.mk_atomic(atomic, object, loc)
    }

    /// `__atomic_compare_exchange_n(ptr, expected, desired, weak, success, failure)`.
    pub(crate) fn atomic_compare_exchange_n(
        &self,
        name: &str,
        mut args: Vec<Expr>,
        loc: Loc,
    ) -> Res<Expr> {
        if args.len() != 6 {
            return err(loc, format!("{name} takes six arguments"));
        }
        let failure_expr = args.swap_remove(5);
        let success_expr = args.swap_remove(4);
        let weak = args.swap_remove(3);
        let desired = args.swap_remove(2);
        let expected = args.swap_remove(1);
        let (addr, object) = self.atomic_pointer(args.swap_remove(0), name)?;
        let success = self.memory_order(&success_expr, OrderUse::ReadModifyWrite);
        let failure = self.memory_order(&failure_expr, OrderUse::Load);
        let expected = self.rvalue(expected)?;
        let expected_ok = expected
            .ty
            .pointee()
            .is_some_and(|p| self.tcx.size_of(p.unatomic()) == self.tcx.size_of(&object));
        if !expected_ok {
            return err(
                expected.loc,
                format!("the second argument of {name} must point to an object of the same size"),
            );
        }
        let desired = self.assign_convert(desired, &object, loc, "passing an argument")?;
        let atomic = AtomicExpr::Cas {
            addr,
            expected,
            desired,
            success,
            failure,
            result: CasResult::SuccessWriteBack,
        };
        let e = self.mk_atomic(atomic, Type::Bool, loc)?;
        self.after(vec![weak, success_expr, failure_expr], e, loc)
    }

    /// The generic (pointer operand) forms: `__atomic_load(ptr, ret, order)`,
    /// `__atomic_store(ptr, val, order)`, `__atomic_exchange(ptr, val, ret, order)` and
    /// `__atomic_compare_exchange(ptr, expected, desired, weak, success, failure)`.
    pub(crate) fn atomic_generic(&self, name: &str, mut args: Vec<Expr>, loc: Loc) -> Res<Expr> {
        let through = |sema: &Sema, pointer: Expr, object: &Type| -> Res<Expr> {
            let pointer = sema.rvalue(pointer)?;
            let same_size = pointer
                .ty
                .pointee()
                .is_some_and(|p| sema.tcx.size_of(p.unatomic()) == sema.tcx.size_of(object));
            if !same_size {
                return err(
                    pointer.loc,
                    format!("the operands of {name} must point to objects of the same size"),
                );
            }
            // The operand is read or written as the atomic object's own type.
            let ploc = pointer.loc;
            let typed = sema.convert(pointer, &object.clone().ptr_to(), ploc)?;
            sema.deref(typed, ploc)
        };
        match name {
            "__atomic_load" if args.len() == 3 => {
                let order_expr = args.swap_remove(2);
                let ret = args.swap_remove(1);
                let (addr, object) = self.atomic_pointer(args.swap_remove(0), name)?;
                let order = self.memory_order(&order_expr, OrderUse::Load);
                let loaded =
                    self.mk_atomic(AtomicExpr::Load { addr, order }, object.clone(), loc)?;
                let target = through(self, ret, &object)?;
                let stored = self.assign(target, loaded, loc)?;
                let e = self.void_of(stored, loc)?;
                self.after(vec![order_expr], e, loc)
            }
            "__atomic_store" if args.len() == 3 => {
                let order_expr = args.swap_remove(2);
                let val = args.swap_remove(1);
                let (addr, object) = self.atomic_pointer(args.swap_remove(0), name)?;
                let order = self.memory_order(&order_expr, OrderUse::Store);
                let value = self.rvalue(through(self, val, &object)?)?;
                let store =
                    self.mk_atomic(AtomicExpr::Store { addr, value, order }, object, loc)?;
                let e = self.void_of(store, loc)?;
                self.after(vec![order_expr], e, loc)
            }
            "__atomic_exchange" if args.len() == 4 => {
                let order_expr = args.swap_remove(3);
                let ret = args.swap_remove(2);
                let val = args.swap_remove(1);
                let (addr, object) = self.atomic_pointer(args.swap_remove(0), name)?;
                let order = self.memory_order(&order_expr, OrderUse::ReadModifyWrite);
                let value = self.rvalue(through(self, val, &object)?)?;
                let old = self.rmw_node(
                    name,
                    RmwOp::Exchange,
                    Yields::Old,
                    PointerStep::Bytes,
                    addr,
                    object.clone(),
                    value,
                    order,
                    loc,
                )?;
                let target = through(self, ret, &object)?;
                let stored = self.assign(target, old, loc)?;
                let e = self.void_of(stored, loc)?;
                self.after(vec![order_expr], e, loc)
            }
            "__atomic_compare_exchange" if args.len() == 6 => {
                let (_, object) = self.atomic_pointer(args[0].clone(), name)?;
                let desired = self.rvalue(through(self, args.remove(2), &object)?)?;
                args.insert(2, desired);
                self.atomic_compare_exchange_n(name, args, loc)
            }
            _ => err(loc, format!("wrong number of arguments to {name}")),
        }
    }

    /// `__atomic_test_and_set(ptr, order)` and `__atomic_clear(ptr, order)`: the object is a byte.
    pub(crate) fn atomic_flag_op(
        &self,
        name: &str,
        set: bool,
        mut args: Vec<Expr>,
        loc: Loc,
    ) -> Res<Expr> {
        if args.len() != 2 {
            return err(loc, format!("{name} takes two arguments"));
        }
        let order_expr = args.swap_remove(1);
        let ptr = self.rvalue(args.swap_remove(0))?;
        if !ptr.ty.is_ptr() {
            return err(
                ptr.loc,
                format!("the first argument of {name} must be a pointer"),
            );
        }
        let ploc = ptr.loc;
        let addr = self.convert(ptr, &Type::UChar.ptr_to(), ploc)?;
        let e = if set {
            let order = self.memory_order(&order_expr, OrderUse::ReadModifyWrite);
            let one = self.int_lit(1, Type::UChar, loc)?;
            let old = self.rmw_node(
                name,
                RmwOp::Exchange,
                Yields::Old,
                PointerStep::Bytes,
                addr,
                Type::UChar,
                one,
                order,
                loc,
            )?;
            self.convert(old, &Type::Bool, loc)?
        } else {
            let order = self.memory_order(&order_expr, OrderUse::Store);
            let value = self.int_lit(0, Type::UChar, loc)?;
            let store =
                self.mk_atomic(AtomicExpr::Store { addr, value, order }, Type::UChar, loc)?;
            self.void_of(store, loc)?
        };
        self.after(vec![order_expr], e, loc)
    }

    /// `__atomic_thread_fence(order)`; a signal fence orders nothing the hardware sees.
    pub(crate) fn atomic_fence(
        &self,
        name: &str,
        hardware: bool,
        mut args: Vec<Expr>,
        loc: Loc,
    ) -> Res<Expr> {
        if args.len() != 1 {
            return err(loc, format!("{name} takes one argument"));
        }
        let order_expr = args.swap_remove(0);
        let order = self.memory_order(&order_expr, OrderUse::ReadModifyWrite);
        let e = if hardware && order != bir::order::RELAXED {
            self.mk_atomic(AtomicExpr::Fence(order), Type::Void, loc)?
        } else {
            let zero = self.int_lit(0, Type::Int, loc)?;
            self.void_of(zero, loc)?
        };
        self.after(vec![order_expr], e, loc)
    }

    /// `__atomic_always_lock_free(size, ptr)` / `__atomic_is_lock_free(size, ptr)`.
    pub(crate) fn atomic_lock_free(&self, name: &str, mut args: Vec<Expr>, loc: Loc) -> Res<Expr> {
        if args.len() != 2 {
            return err(loc, format!("{name} takes two arguments"));
        }
        let size = self.rvalue(args.swap_remove(0))?;
        if !size.ty.is_integer() {
            return err(
                loc,
                format!("the first argument of {name} must be an integer"),
            );
        }
        let eight = self.int_lit(8, size.ty.clone(), loc)?;
        let fits = self.binary(BinOp::Le, size, eight, loc)?;
        self.convert(fits, &Type::Bool, loc)
    }

    /// `__sync_fetch_and_OP(ptr, value, ...)` and `__sync_OP_and_fetch`.
    pub(crate) fn sync_rmw(
        &self,
        name: &str,
        op: RmwOp,
        yields: Yields,
        mut args: Vec<Expr>,
        loc: Loc,
    ) -> Res<Expr> {
        if args.len() < 2 {
            return err(loc, format!("{name} takes two arguments"));
        }
        args.truncate(2);
        let value = args.swap_remove(1);
        let (addr, object) = self.atomic_pointer(args.swap_remove(0), name)?;
        self.rmw_node(
            name,
            op,
            yields,
            PointerStep::Bytes,
            addr,
            object,
            value,
            bir::order::SEQ_CST,
            loc,
        )
    }

    /// `__sync_bool_compare_and_swap` / `__sync_val_compare_and_swap(ptr, old, new, ...)`.
    pub(crate) fn sync_compare_and_swap(
        &self,
        name: &str,
        want_value: bool,
        mut args: Vec<Expr>,
        loc: Loc,
    ) -> Res<Expr> {
        if args.len() < 3 {
            return err(loc, format!("{name} takes three arguments"));
        }
        args.truncate(3);
        let desired = args.swap_remove(2);
        let expected = args.swap_remove(1);
        let (addr, object) = self.atomic_pointer(args.swap_remove(0), name)?;
        let expected = self.assign_convert(expected, &object, loc, "passing an argument")?;
        let desired = self.assign_convert(desired, &object, loc, "passing an argument")?;
        let (result, ty) = if want_value {
            (CasResult::Old, object)
        } else {
            (CasResult::Success, Type::Bool)
        };
        let atomic = AtomicExpr::Cas {
            addr,
            expected,
            desired,
            success: bir::order::SEQ_CST,
            failure: bir::order::SEQ_CST,
            result,
        };
        self.mk_atomic(atomic, ty, loc)
    }

    /// `__sync_lock_test_and_set(ptr, value)`: an acquire exchange.
    pub(crate) fn sync_lock_test_and_set(
        &self,
        name: &str,
        mut args: Vec<Expr>,
        loc: Loc,
    ) -> Res<Expr> {
        if args.len() < 2 {
            return err(loc, format!("{name} takes two arguments"));
        }
        args.truncate(2);
        let value = args.swap_remove(1);
        let (addr, object) = self.atomic_pointer(args.swap_remove(0), name)?;
        self.rmw_node(
            name,
            RmwOp::Exchange,
            Yields::Old,
            PointerStep::Bytes,
            addr,
            object,
            value,
            bir::order::ACQUIRE,
            loc,
        )
    }

    /// `__sync_lock_release(ptr)`: a release store of zero.
    pub(crate) fn sync_lock_release(&self, name: &str, mut args: Vec<Expr>, loc: Loc) -> Res<Expr> {
        if args.is_empty() {
            return err(loc, format!("{name} takes one argument"));
        }
        let (addr, object) = self.atomic_pointer(args.swap_remove(0), name)?;
        let zero = self.int_lit(0, Type::Int, loc)?;
        let value = self.convert(zero, &object, loc)?;
        let store = self.mk_atomic(
            AtomicExpr::Store {
                addr,
                value,
                order: bir::order::RELEASE,
            },
            object,
            loc,
        )?;
        self.void_of(store, loc)
    }
}

/// The bytes of a constant vector expression.
pub(crate) fn vector_bytes(e: &Expr, tcx: &crate::types::TypeCtx) -> Option<[u8; 16]> {
    let lane_bytes = |lane: &Expr| -> Option<(Vec<u8>, usize)> {
        let width = tcx.size_of(&lane.ty)? as usize;
        let bytes = match constexpr::eval(lane, tcx).ok()? {
            Const::Int(v) => v.to_le_bytes()[..width.min(8)].to_vec(),
            Const::Float(v) if matches!(lane.ty, Type::Float) => {
                (v as f32).to_bits().to_le_bytes().to_vec()
            }
            Const::Float(v) => v.to_bits().to_le_bytes().to_vec(),
            Const::LongDouble(_) | Const::Addr { .. } => return None,
        };
        Some((bytes, width))
    };
    let Some(size @ (8 | 16)) = tcx.size_of(&e.ty) else {
        return None;
    };
    let size = size as usize;
    let mut out = [0u8; 16];
    match &e.kind {
        ExprKind::VecInit(lanes) => {
            let mut at = 0;
            for lane in lanes {
                let (bytes, width) = lane_bytes(lane)?;
                if at + width > size || bytes.len() != width {
                    return None;
                }
                out[at..at + width].copy_from_slice(&bytes);
                at += width;
            }
            Some(out)
        }
        ExprKind::VecSplat(lane) => {
            let (bytes, width) = lane_bytes(lane)?;
            if width == 0 || bytes.len() != width || 16 % width != 0 {
                return None;
            }
            for chunk in out[..size].chunks_mut(width) {
                chunk.copy_from_slice(&bytes);
            }
            Some(out)
        }
        ExprKind::Cast(inner) if inner.ty.is_vector() => vector_bytes(inner, tcx),
        _ => None,
    }
}

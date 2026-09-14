//! Code generation for vectors and atomics.
//!
//! A 16-byte vector is a V128 value. An 8-byte vector travels as the 64-bit scalar that holds
//! it in memory and in calls (`TypeCtx::half_vector_carrier`); an operation on one moves it
//! into the low half of a V128 whose high half is zero, computes there, and takes the low half
//! back out.
//!
//! Every lane-wise C operation becomes one BIR vector instruction. The exceptions, which
//! BIR has no instruction for and which are therefore done lane by lane with
//! VExtract/VReplace (or through a stack slot when the lane is chosen at run time):
//!
//! * `v << w` / `v >> w` with a vector of shift amounts,
//! * `v[i]` with a run-time `i`, and `__builtin_shuffle` with a run-time mask,
//! * `__builtin_convertvector` between 64-bit integer and `double` lanes.
//!
//! Atomic read-modify-write operations BIR has no `AtomicOp` for (nand, min, max, the
//! `*= /= %= <<= >>=` operators, floating-point arithmetic, `_Bool`) are compare-and-swap loops.

use super::{FnGen, Place, internal};
use crate::ast::*;
use crate::bir::{self, BinOp as CBin, ConvOp, Inst, Lane, MemKind, Ty, UnOp, V, VBitsOp, VLaneOp};
use crate::sema::simd::vector_bytes;
use crate::token::{Loc, Res};
use crate::types::Type;

/// Whether two expressions are the same side-effect-free read, so one evaluation serves both.
fn same_pure(a: &Expr, b: &Expr) -> bool {
    match (&a.kind, &b.kind) {
        (ExprKind::Local(x), ExprKind::Local(y)) => x == y && a.ty == b.ty,
        (ExprKind::Cast(x), ExprKind::Cast(y)) => a.ty == b.ty && same_pure(x, y),
        _ => false,
    }
}

impl FnGen<'_, '_> {
    fn lane_of(&self, ty: &Type, loc: Loc) -> Res<Lane> {
        match self.tcx.lane_of(ty) {
            Some(lane) => Ok(lane),
            None => internal(loc, "operation on a vector that is not 8 or 16 bytes"),
        }
    }

    /// The V128 to compute with for vector value `v`: itself, or the 8-byte vector it
    /// carries in the low half of zeros.
    pub(super) fn whole_vector(&mut self, v: V) -> V {
        let lane = match self.b.value_ty(v) {
            Ty::F64 => Lane::F64x2,
            Ty::I64 => Lane::I64x2,
            _ => return v,
        };
        let zeros = self.const_v128([0; 16]);
        self.replace(lane, 0, zeros, v)
    }

    /// The low half of `v` as a value of machine type `carrier`, or `v` itself as a V128.
    pub(super) fn low_half_as(&mut self, v: V, carrier: Ty) -> V {
        match carrier {
            Ty::F64 => self.extract(Lane::F64x2, false, 0, v),
            Ty::I64 => self.extract(Lane::I64x2, false, 0, v),
            _ => v,
        }
    }

    /// The V128 result `v` as a value of vector type `ty`.
    fn vector_result(&mut self, ty: &Type, v: V) -> V {
        if self.tcx.is_half_vector(ty) {
            let carrier = self.tcx.half_vector_carrier();
            return self.low_half_as(v, carrier);
        }
        v
    }

    /// `v` with every byte above the vector type `ty` set, so that the unused lanes of a
    /// divisor are not zero.
    fn ones_above(&mut self, ty: &Type, v: V) -> V {
        if !self.tcx.is_half_vector(ty) {
            return v;
        }
        let mut bytes = [0u8; 16];
        bytes[8..].fill(0xff);
        let upper = self.const_v128(bytes);
        self.b.vbits(VBitsOp::Or, vec![v, upper])
    }

    /// Whether lanes of vector type `ty` are signed (floating lanes count as signed).
    fn lanes_signed(&self, ty: &Type) -> bool {
        ty.vector_elem()
            .is_some_and(|elem| elem.is_float() || self.tcx.is_signed(elem))
    }

    pub(super) fn const_v128(&mut self, bytes: [u8; 16]) -> V {
        self.b.def(Inst::ConstV128(bytes), Ty::V128)
    }

    fn extract(&mut self, lane: Lane, signed: bool, index: u8, v: V) -> V {
        self.b
            .def(Inst::VExtract(lane, signed, index, v), lane.scalar_ty())
    }

    fn replace(&mut self, lane: Lane, index: u8, vec: V, scalar: V) -> V {
        self.b
            .def(Inst::VReplace(lane, index, vec, scalar), Ty::V128)
    }

    /// A 16-byte aligned scratch slot holding `count` vectors; returns its address.
    fn vector_scratch(&mut self, count: u64) -> V {
        self.temporary_slot(16 * count, 16)
    }

    /// `base + (index mod count) * lane size`, for a lane chosen at run time.
    fn lane_address(&mut self, base: V, offset: i64, index: V, lane: Lane, count: u32) -> V {
        let mask = self.b.const_i32(count as i32 - 1);
        let bounded = self.b.bin(CBin::And, index, mask);
        let wide = self.b.un(UnOp::ZExt32, bounded);
        let width = self.b.const_i64(16 / i64::from(lane.count()));
        let scaled = self.b.bin(CBin::Mul, wide, width);
        let start = if offset == 0 {
            base
        } else {
            let delta = self.b.const_i64(offset);
            self.b.bin(CBin::Add, base, delta)
        };
        self.b.bin(CBin::Add, start, scaled)
    }

    /// The place `v[i]` designates, for an lvalue `v`.
    pub(super) fn gen_lane_place(&mut self, e: &Expr, base: &Expr, index: &Expr) -> Res<Place> {
        let lane = self.lane_of(&base.ty, e.loc)?;
        let count = self.tcx.lane_count(&base.ty);
        let place = self.gen_place(base)?;
        let constant = match index.kind {
            ExprKind::IntLit(i) => Some((i as u64 % u64::from(count)) as u8),
            _ => None,
        };
        match (place, constant) {
            (Place::Reg(local), Some(index)) => Ok(Place::Lane {
                local,
                lane,
                index,
                signed: self.tcx.is_signed(&e.ty),
            }),
            (Place::Mem { base, offset }, Some(index)) => Ok(Place::Mem {
                base,
                offset: offset + i64::from(index) * (16 / i64::from(lane.count())),
            }),
            (Place::Mem { base, offset }, None) => {
                let held = self.hold(base, index.has_control_flow);
                let i = self.gen_value(index)?;
                let base = self.release(held);
                Ok(Place::Mem {
                    base: self.lane_address(base, offset, i, lane, count),
                    offset: 0,
                })
            }
            _ => internal(e.loc, "run-time lane of a vector that is not in memory"),
        }
    }

    /// `v[i]` where `v` is not an lvalue.
    fn gen_lane_value(&mut self, e: &Expr, base: &Expr, index: &Expr) -> Res<V> {
        let lane = self.lane_of(&base.ty, e.loc)?;
        let count = self.tcx.lane_count(&base.ty);
        let v = self.gen_value(base)?;
        let v = self.whole_vector(v);
        if let ExprKind::IntLit(i) = index.kind {
            let index = (i as u64 % u64::from(count)) as u8;
            return Ok(self.extract(lane, self.tcx.is_signed(&e.ty), index, v));
        }
        let held = self.hold(v, index.has_control_flow);
        let i = self.gen_value(index)?;
        let v = self.release(held);
        let scratch = self.vector_scratch(1);
        self.b.effect(Inst::Store(MemKind::V128, v, scratch, 0));
        let address = self.lane_address(scratch, 0, i, lane, count);
        Ok(self.b.load(self.tcx.mem_kind(&e.ty, false), address, 0))
    }

    /// A lane-wise binary operation on vectors of type `ty`; `amount_ty` is the type of the
    /// right operand (a shift amount may be a scalar).
    pub(super) fn gen_vec_binary(
        &mut self,
        op: BinOp,
        ty: &Type,
        a: V,
        b: V,
        amount_ty: &Type,
        loc: Loc,
    ) -> Res<V> {
        let lane = self.lane_of(ty, loc)?;
        let count = self.tcx.lane_count(ty);
        let signed = self.lanes_signed(ty);
        let a = self.whole_vector(a);
        let b = if amount_ty.is_vector() {
            self.whole_vector(b)
        } else {
            b
        };
        let b = if matches!(op, BinOp::Div | BinOp::Rem) && !lane.is_float() {
            self.ones_above(ty, b)
        } else {
            b
        };
        let result = self.vec_binary_whole(op, lane, count, signed, a, b, amount_ty)?;
        Ok(self.vector_result(ty, result))
    }

    /// `gen_vec_binary` on V128 operands; `count` lanes of them are the vector.
    fn vec_binary_whole(
        &mut self,
        op: BinOp,
        lane: Lane,
        count: u32,
        signed: bool,
        a: V,
        b: V,
        amount_ty: &Type,
    ) -> Res<V> {
        let lane_op = match op {
            BinOp::Add => VLaneOp::Add,
            BinOp::Sub => VLaneOp::Sub,
            BinOp::Mul => VLaneOp::Mul,
            BinOp::Div => VLaneOp::Div,
            BinOp::Rem => VLaneOp::Rem,
            BinOp::And => return Ok(self.b.vbits(VBitsOp::And, vec![a, b])),
            BinOp::Or => return Ok(self.b.vbits(VBitsOp::Or, vec![a, b])),
            BinOp::Xor => return Ok(self.b.vbits(VBitsOp::Xor, vec![a, b])),
            BinOp::Shl => VLaneOp::Shl,
            BinOp::Shr if signed => VLaneOp::ShrS,
            BinOp::Shr => VLaneOp::ShrU,
            BinOp::Eq => VLaneOp::Eq,
            BinOp::Ne => VLaneOp::Ne,
            BinOp::Lt => VLaneOp::Lt,
            BinOp::Le => VLaneOp::Le,
            BinOp::Gt => VLaneOp::Gt,
            BinOp::Ge => VLaneOp::Ge,
        };
        if matches!(op, BinOp::Shl | BinOp::Shr) && amount_ty.is_vector() {
            // A different amount per lane: BIR shifts every lane by one amount.
            let scalar_op = match lane_op {
                VLaneOp::Shl => CBin::Shl,
                VLaneOp::ShrS => CBin::ShrS,
                _ => CBin::ShrU,
            };
            let mut result = a;
            for i in 0..count as u8 {
                let x = self.extract(lane, signed, i, a);
                let amount = self.extract(lane, false, i, b);
                let amount = if lane == Lane::I64x2 {
                    self.b.un(UnOp::Trunc, amount)
                } else {
                    amount
                };
                let shifted = self.b.bin(scalar_op, x, amount);
                result = self.replace(lane, i, result, shifted);
            }
            return Ok(result);
        }
        Ok(self.b.vlane(lane_op, lane, signed, vec![a, b]))
    }

    pub(super) fn gen_vec_neg(&mut self, ty: &Type, v: V, loc: Loc) -> Res<V> {
        let lane = self.lane_of(ty, loc)?;
        let v = self.whole_vector(v);
        let negated = self.b.vlane(VLaneOp::Neg, lane, false, vec![v]);
        Ok(self.vector_result(ty, negated))
    }

    pub(super) fn gen_vec_not(&mut self, ty: &Type, v: V) -> V {
        let v = self.whole_vector(v);
        let inverted = self.b.vbits(VBitsOp::Not, vec![v]);
        self.vector_result(ty, inverted)
    }

    pub(super) fn gen_vec_splat(&mut self, e: &Expr, scalar: &Expr) -> Res<V> {
        if let Some(bytes) = vector_bytes(e, self.tcx) {
            let constant = self.const_v128(bytes);
            return Ok(self.vector_result(&e.ty, constant));
        }
        let lane = self.lane_of(&e.ty, e.loc)?;
        let v = self.gen_value(scalar)?;
        let splat = self.b.vlane(VLaneOp::Splat, lane, false, vec![v]);
        Ok(self.vector_result(&e.ty, splat))
    }

    /// `{ a, b, ... }`: a constant, a splat, or the constant lanes with the others inserted.
    pub(super) fn gen_vec_init(&mut self, e: &Expr, lanes: &[Expr]) -> Res<V> {
        if let Some(bytes) = vector_bytes(e, self.tcx) {
            let constant = self.const_v128(bytes);
            return Ok(self.vector_result(&e.ty, constant));
        }
        let lane = self.lane_of(&e.ty, e.loc)?;
        if lanes.len() != self.tcx.lane_count(&e.ty) as usize {
            return internal(e.loc, "vector initializer with the wrong number of lanes");
        }
        if let Some((first, rest)) = lanes.split_first() {
            if rest.iter().all(|other| same_pure(first, other)) {
                let v = self.gen_value(first)?;
                let splat = self.b.vlane(VLaneOp::Splat, lane, false, vec![v]);
                return Ok(self.vector_result(&e.ty, splat));
            }
        }
        let width = 16 / lane.count() as usize;
        let mut image = [0u8; 16];
        let mut computed = Vec::new();
        for (i, item) in lanes.iter().enumerate() {
            let constant = match crate::constexpr::eval(item, self.tcx) {
                Ok(crate::constexpr::Const::Int(v)) => Some(v.to_le_bytes()),
                Ok(crate::constexpr::Const::Float(v)) if matches!(item.ty, Type::Float) => {
                    let mut bytes = [0u8; 8];
                    bytes[..4].copy_from_slice(&(v as f32).to_bits().to_le_bytes());
                    Some(bytes)
                }
                Ok(crate::constexpr::Const::Float(v)) => Some(v.to_bits().to_le_bytes()),
                _ => None,
            };
            match constant {
                Some(bytes) => image[i * width..(i + 1) * width].copy_from_slice(&bytes[..width]),
                None => computed.push(i),
            }
        }
        // Evaluate in source order, then insert.
        let mut held = Vec::with_capacity(computed.len());
        for (k, &i) in computed.iter().enumerate() {
            let v = self.gen_value(&lanes[i])?;
            let later = computed[k + 1..].iter().any(|&j| lanes[j].has_control_flow);
            held.push(self.hold(v, later));
        }
        let values: Vec<V> = held.into_iter().map(|h| self.release(h)).collect();
        let mut result = self.const_v128(image);
        for (&i, v) in computed.iter().zip(values) {
            result = self.replace(lane, i as u8, result, v);
        }
        Ok(self.vector_result(&e.ty, result))
    }

    /// Evaluates the operands of a builtin left to right.
    fn gen_operands(&mut self, args: &[Expr]) -> Res<Vec<V>> {
        let mut held = Vec::with_capacity(args.len());
        for (i, arg) in args.iter().enumerate() {
            let v = self.gen_value(arg)?;
            let later = args[i + 1..].iter().any(|a| a.has_control_flow);
            held.push((self.hold(v, later), arg.ty.is_vector()));
        }
        let mut values = Vec::with_capacity(held.len());
        for (held, is_vector) in held {
            let v = self.release(held);
            values.push(if is_vector { self.whole_vector(v) } else { v });
        }
        Ok(values)
    }

    fn reduce_step(&mut self, op: ReduceOp, lane: Lane, signed: bool, a: V, b: V) -> V {
        let lane_op = match op {
            ReduceOp::Add => VLaneOp::Add,
            ReduceOp::Mul => VLaneOp::Mul,
            ReduceOp::Min => VLaneOp::Min,
            ReduceOp::Max => VLaneOp::Max,
            ReduceOp::Minimum => VLaneOp::FMin,
            ReduceOp::Maximum => VLaneOp::FMax,
            ReduceOp::And => return self.b.vbits(VBitsOp::And, vec![a, b]),
            ReduceOp::Or => return self.b.vbits(VBitsOp::Or, vec![a, b]),
            ReduceOp::Xor => return self.b.vbits(VBitsOp::Xor, vec![a, b]),
        };
        self.b.vlane(lane_op, lane, signed, vec![a, b])
    }

    /// Converts every lane with the scalar conversion, for shapes BIR has no VConvert for.
    fn convert_lanes(&mut self, v: V, from: &Type, to: &Type, loc: Loc) -> Res<V> {
        let (from_lane, to_lane) = (self.lane_of(from, loc)?, self.lane_of(to, loc)?);
        let (Some(from_elem), Some(to_elem)) = (from.vector_elem(), to.vector_elem()) else {
            return internal(loc, "lane conversion of a non-vector");
        };
        let (from_elem, to_elem) = (from_elem.clone(), to_elem.clone());
        let mut result = self.const_v128([0; 16]);
        let count = self.tcx.lane_count(from).min(self.tcx.lane_count(to)) as u8;
        for i in 0..count {
            let x = self.extract(from_lane, self.tcx.is_signed(&from_elem), i, v);
            let y = self.convert(x, &from_elem, &to_elem, loc)?;
            result = self.replace(to_lane, i, result, y);
        }
        Ok(result)
    }

    pub(super) fn gen_vec_builtin(&mut self, e: &Expr, op: VecBuiltin, args: &[Expr]) -> Res<V> {
        let loc = e.loc;
        let values = self.gen_operands(args)?;
        let operand_ty = match args.first() {
            Some(arg) => arg.ty.clone(),
            None => return internal(loc, "vector builtin without operands"),
        };
        let lane = self.lane_of(&operand_ty, loc)?;
        let count = self.tcx.lane_count(&operand_ty);
        let signed = self.lanes_signed(&operand_ty);
        let v = |i: usize| -> Res<V> {
            match values.get(i) {
                Some(&v) => Ok(v),
                None => internal(loc, "vector builtin with too few operands"),
            }
        };
        let result = match op {
            VecBuiltin::Shuffle(bytes) => self.b.def(Inst::VShuffle(v(0)?, v(1)?, bytes), Ty::V128),
            VecBuiltin::ShuffleDynamic { two_inputs } if lane == Lane::I8x16 && count == 16 => {
                // Byte indices are what VSwizzle takes; it gives 0 for an index of 16 or
                // more, so the second input is picked with the index moved down by 16.
                let (a, b, mask) = (v(0)?, v(1)?, v(2)?);
                let limit = self.const_v128([if two_inputs { 31 } else { 15 }; 16]);
                let index = self.b.vbits(VBitsOp::And, vec![mask, limit]);
                let from_a = self.b.vbits(VBitsOp::Swizzle, vec![a, index]);
                if two_inputs {
                    let sixteen = self.const_v128([16; 16]);
                    let moved =
                        self.b
                            .vlane(VLaneOp::Sub, Lane::I8x16, false, vec![index, sixteen]);
                    let from_b = self.b.vbits(VBitsOp::Swizzle, vec![b, moved]);
                    self.b.vbits(VBitsOp::Or, vec![from_a, from_b])
                } else {
                    from_a
                }
            }
            VecBuiltin::ShuffleDynamic { two_inputs } => {
                let (a, b, mask) = (v(0)?, v(1)?, v(2)?);
                let mask_lane = self.lane_of(&args[2].ty, loc)?;
                // The lanes of `b` follow those of `a` in memory.
                let scratch = self.vector_scratch(2);
                let width = 16 / i64::from(lane.count());
                let count = i64::from(count);
                self.b.effect(Inst::Store(MemKind::V128, a, scratch, 0));
                self.b
                    .effect(Inst::Store(MemKind::V128, b, scratch, count * width));
                let modulus = if two_inputs { count * 2 } else { count };
                let kind = match operand_ty.vector_elem() {
                    Some(elem) => self.tcx.mem_kind(elem, false),
                    None => return internal(loc, "shuffle of a non-vector"),
                };
                let mut result = a;
                for i in 0..count as u8 {
                    let pick = self.extract(mask_lane, false, i, mask);
                    let pick = if mask_lane == Lane::I64x2 {
                        pick
                    } else {
                        self.b.un(UnOp::ZExt32, pick)
                    };
                    let limit = self.b.const_i64(modulus - 1);
                    let bounded = self.b.bin(CBin::And, pick, limit);
                    let stride = self.b.const_i64(width);
                    let offset = self.b.bin(CBin::Mul, bounded, stride);
                    let address = self.b.bin(CBin::Add, scratch, offset);
                    let element = self.b.load(kind, address, 0);
                    result = self.replace(lane, i, result, element);
                }
                result
            }
            VecBuiltin::Select => self.b.vbits(VBitsOp::Select, vec![v(0)?, v(1)?, v(2)?]),
            VecBuiltin::Convert => {
                let to_lane = self.lane_of(&e.ty, loc)?;
                let to_signed = self.lanes_signed(&e.ty);
                let half = self.tcx.is_half_vector(&operand_ty);
                match (lane, to_lane) {
                    (from, to) if from == to => v(0)?,
                    // The low half of the lanes, each made twice as wide.
                    (Lane::I8x16, Lane::I16x8) if half => self.b.def(
                        Inst::VConvert(if signed { 10 } else { 11 }, v(0)?),
                        Ty::V128,
                    ),
                    (Lane::I16x8, Lane::I32x4) if half => self.b.def(
                        Inst::VConvert(if signed { 14 } else { 15 }, v(0)?),
                        Ty::V128,
                    ),
                    (Lane::I32x4, Lane::I64x2) if half => self.b.def(
                        Inst::VConvert(if signed { 18 } else { 19 }, v(0)?),
                        Ty::V128,
                    ),
                    (Lane::I32x4, Lane::F64x2) if half => self
                        .b
                        .def(Inst::VConvert(if signed { 4 } else { 5 }, v(0)?), Ty::V128),
                    (Lane::F32x4, Lane::F64x2) if half => {
                        self.b.def(Inst::VConvert(8, v(0)?), Ty::V128)
                    }
                    (Lane::F64x2, Lane::F32x4) if !half => {
                        self.b.def(Inst::VConvert(9, v(0)?), Ty::V128)
                    }
                    // Integer lanes cut down to their low bytes.
                    (from, to)
                        if !from.is_float() && !to.is_float() && to.count() > from.count() =>
                    {
                        let (wide, narrow) = (16 / from.count(), 16 / to.count());
                        let mut bytes = [0u8; 16];
                        for (i, byte) in bytes
                            .iter_mut()
                            .enumerate()
                            .take(count as usize * narrow as usize)
                        {
                            *byte = (i as u8 / narrow) * wide + i as u8 % narrow;
                        }
                        self.b.def(Inst::VShuffle(v(0)?, v(0)?, bytes), Ty::V128)
                    }
                    (Lane::I32x4, Lane::F32x4) => self
                        .b
                        .def(Inst::VConvert(if signed { 0 } else { 1 }, v(0)?), Ty::V128),
                    (Lane::F32x4, Lane::I32x4) => self.b.def(
                        Inst::VConvert(if to_signed { 2 } else { 3 }, v(0)?),
                        Ty::V128,
                    ),
                    (Lane::I64x2, Lane::F64x2) => self.b.def(
                        Inst::VConvert(if signed { 22 } else { 23 }, v(0)?),
                        Ty::V128,
                    ),
                    (Lane::F64x2, Lane::I64x2) => self.b.def(
                        Inst::VConvert(if to_signed { 24 } else { 25 }, v(0)?),
                        Ty::V128,
                    ),
                    _ => self.convert_lanes(v(0)?, &operand_ty, &e.ty, loc)?,
                }
            }
            VecBuiltin::ConvertKind(kind) => self.b.def(Inst::VConvert(kind, v(0)?), Ty::V128),
            VecBuiltin::Abs => self.b.vlane(VLaneOp::Abs, lane, false, vec![v(0)?]),
            VecBuiltin::Sqrt => self.b.vlane(VLaneOp::Sqrt, lane, false, vec![v(0)?]),
            VecBuiltin::Min => self.b.vlane(VLaneOp::Min, lane, signed, vec![v(0)?, v(1)?]),
            VecBuiltin::Max => self.b.vlane(VLaneOp::Max, lane, signed, vec![v(0)?, v(1)?]),
            VecBuiltin::Minimum => self.b.vlane(VLaneOp::FMin, lane, false, vec![v(0)?, v(1)?]),
            VecBuiltin::Maximum => self.b.vlane(VLaneOp::FMax, lane, false, vec![v(0)?, v(1)?]),
            VecBuiltin::Reduce(reduce) => {
                // Fold the upper half onto the lower half until one lane is left.
                let mut acc = v(0)?;
                let width = 16 / u32::from(lane.count());
                let mut step = count / 2;
                while step >= 1 {
                    let mut bytes = [0u8; 16];
                    for (i, byte) in bytes.iter_mut().enumerate() {
                        let source_lane = (i as u32 / width + step) % count;
                        *byte = (source_lane * width + i as u32 % width) as u8;
                    }
                    let moved = self.b.def(Inst::VShuffle(acc, acc, bytes), Ty::V128);
                    acc = self.reduce_step(reduce, lane, signed, acc, moved);
                    step /= 2;
                }
                self.extract(lane, self.tcx.is_signed(&e.ty), 0, acc)
            }
            VecBuiltin::Bitmask => {
                let integer = match lane {
                    Lane::F32x4 => Lane::I32x4,
                    Lane::F64x2 => Lane::I64x2,
                    other => other,
                };
                let bits = self.b.vlane(VLaneOp::Bitmask, integer, false, vec![v(0)?]);
                if count < u32::from(lane.count()) {
                    let present = self.b.const_i32((1 << count) - 1);
                    self.b.bin(CBin::And, bits, present)
                } else {
                    bits
                }
            }
            VecBuiltin::AddSat { signed } => {
                self.b
                    .vlane(VLaneOp::AddSat, lane, signed, vec![v(0)?, v(1)?])
            }
            VecBuiltin::SubSat { signed } => {
                self.b
                    .vlane(VLaneOp::SubSat, lane, signed, vec![v(0)?, v(1)?])
            }
            VecBuiltin::AverageUnsigned => {
                self.b.vlane(VLaneOp::AvgU, lane, false, vec![v(0)?, v(1)?])
            }
            VecBuiltin::Narrow { signed } => {
                self.b
                    .vlane(VLaneOp::Narrow, lane, signed, vec![v(0)?, v(1)?])
            }
            VecBuiltin::DotProduct => self.b.vbits(VBitsOp::Dot, vec![v(0)?, v(1)?]),
            VecBuiltin::Swizzle => self.b.vbits(VBitsOp::Swizzle, vec![v(0)?, v(1)?]),
            VecBuiltin::ExtMul { signed, high } => {
                let result = self.lane_of(&e.ty, loc)?;
                self.b
                    .def(Inst::VExtMul(result, signed, high, v(0)?, v(1)?), Ty::V128)
            }
            VecBuiltin::MulHigh16 { signed } => {
                // The 32-bit products of the low and of the high four lanes; their upper
                // halves are bytes 2 and 3 of each.
                let low = self.b.def(
                    Inst::VExtMul(Lane::I32x4, signed, false, v(0)?, v(1)?),
                    Ty::V128,
                );
                let high = self.b.def(
                    Inst::VExtMul(Lane::I32x4, signed, true, v(0)?, v(1)?),
                    Ty::V128,
                );
                let upper_halves = [2, 3, 6, 7, 10, 11, 14, 15, 18, 19, 22, 23, 26, 27, 30, 31];
                self.b
                    .def(Inst::VShuffle(low, high, upper_halves), Ty::V128)
            }
            VecBuiltin::TestZero => {
                let both = self.b.vbits(VBitsOp::And, vec![v(0)?, v(1)?]);
                let any = self.b.vbits(VBitsOp::AnyTrue, vec![both]);
                let zero = self.b.const_i32(0);
                self.b.bin(CBin::Eq, any, zero)
            }
        };
        Ok(if e.ty.is_vector() {
            self.vector_result(&e.ty, result)
        } else {
            result
        })
    }

    // ───────────────────────────── atomics ─────────────────────────────

    /// The unsigned memory kind of an atomic access to an object of type `ty`.
    fn atomic_kind(&self, ty: &Type) -> MemKind {
        match self.tcx.size_of(ty) {
            Some(1) => MemKind::I8U,
            Some(2) => MemKind::I16U,
            Some(4) => MemKind::I32,
            _ => MemKind::I64,
        }
    }

    /// The integer that carries value `v` of C type `ty` to an atomic instruction, with a
    /// narrow value zero-extended so it compares equal to what the instructions return.
    fn atomic_bits(&mut self, v: V, ty: &Type) -> V {
        match ty {
            Type::Float => self.b.conv(ConvOp::Bitcast, Ty::I32, v),
            Type::Double => self.b.conv(ConvOp::Bitcast, Ty::I64, v),
            _ => match self.tcx.size_of(ty) {
                Some(1) => {
                    let mask = self.b.const_i32(0xff);
                    self.b.bin(CBin::And, v, mask)
                }
                Some(2) => {
                    let mask = self.b.const_i32(0xffff);
                    self.b.bin(CBin::And, v, mask)
                }
                _ => v,
            },
        }
    }

    /// The C value of type `ty` that an atomic instruction's (zero-extended) result stands for.
    fn atomic_value(&mut self, raw: V, ty: &Type) -> V {
        match ty {
            Type::Float => self.b.conv(ConvOp::Bitcast, Ty::F32, raw),
            Type::Double => self.b.conv(ConvOp::Bitcast, Ty::F64, raw),
            Type::Bool => raw,
            _ if self.tcx.is_narrow(ty) && self.tcx.is_signed(ty) => self.normalize(raw, ty),
            _ => raw,
        }
    }

    /// What a read-modify-write stores, given the old value (of the object's type `object`)
    /// and the operand; the result has type `object` again.
    fn rmw_result(
        &mut self,
        op: RmwOp,
        old: V,
        operand: V,
        object: &Type,
        op_ty: &Type,
        loc: Loc,
    ) -> Res<V> {
        let result = self.rmw_raw_result(op, old, operand, object, op_ty, loc)?;
        // The builtins compute in the object's own type, so a narrow result needs wrapping.
        if op_ty == object && self.tcx.is_narrow(object) && !matches!(op, RmwOp::Exchange) {
            return Ok(self.normalize(result, object));
        }
        Ok(result)
    }

    fn rmw_raw_result(
        &mut self,
        op: RmwOp,
        old: V,
        operand: V,
        object: &Type,
        op_ty: &Type,
        loc: Loc,
    ) -> Res<V> {
        Ok(match op {
            RmwOp::Exchange => operand,
            RmwOp::PtrAdd { scale, sub } => self.emit_ptr_add(old, operand, scale, sub),
            RmwOp::Arith(bop) => {
                let widened = self.convert(old, object, op_ty, loc)?;
                let result = self.b.bin(self.arith_op(bop, op_ty), widened, operand);
                self.convert(result, op_ty, object, loc)?
            }
            RmwOp::Nand => {
                let widened = self.convert(old, object, op_ty, loc)?;
                let both = self.b.bin(CBin::And, widened, operand);
                let ones = self.b.const_int(self.b.value_ty(both), -1);
                let result = self.b.bin(CBin::Xor, both, ones);
                self.convert(result, op_ty, object, loc)?
            }
            RmwOp::Min | RmwOp::Max => {
                let widened = self.convert(old, object, op_ty, loc)?;
                let compare = if op == RmwOp::Min {
                    BinOp::Lt
                } else {
                    BinOp::Gt
                };
                let keep = self.b.bin(self.arith_op(compare, op_ty), widened, operand);
                let mty = self.b.value_ty(widened);
                let chosen = self.b.def(Inst::Select(keep, widened, operand), mty);
                self.convert(chosen, op_ty, object, loc)?
            }
        })
    }

    pub(super) fn gen_atomic(&mut self, e: &Expr, atomic: &AtomicExpr) -> Res<Option<V>> {
        let loc = e.loc;
        match atomic {
            AtomicExpr::Fence(order) => {
                self.b.effect(Inst::Fence(*order));
                Ok(None)
            }
            AtomicExpr::Load { addr, order } => {
                let address = self.gen_value(addr)?;
                let kind = if e.ty.is_float() {
                    self.atomic_kind(&e.ty)
                } else {
                    self.tcx.mem_kind(&e.ty, false)
                };
                let raw = self
                    .b
                    .def(Inst::AtomicLoad(kind, *order, address), kind.value_ty());
                Ok(Some(match e.ty {
                    Type::Float => self.b.conv(ConvOp::Bitcast, Ty::F32, raw),
                    Type::Double => self.b.conv(ConvOp::Bitcast, Ty::F64, raw),
                    _ => raw,
                }))
            }
            AtomicExpr::Store { addr, value, order } => {
                let address = self.gen_value(addr)?;
                let held = self.hold(address, value.has_control_flow);
                let v = self.gen_value(value)?;
                let address = self.release(held);
                let bits = self.atomic_bits(v, &e.ty);
                self.b.effect(Inst::AtomicStore(
                    self.atomic_kind(&e.ty),
                    *order,
                    bits,
                    address,
                ));
                Ok(Some(v))
            }
            AtomicExpr::Rmw {
                addr,
                value,
                op,
                op_ty,
                order,
                want_new,
            } => {
                let address = self.gen_value(addr)?;
                let held = self.hold(address, value.has_control_flow);
                let operand = self.gen_value(value)?;
                let address = self.release(held);
                self.gen_rmw(
                    &e.ty, *op, op_ty, &value.ty, address, operand, *order, *want_new, loc,
                )
                .map(Some)
            }
            AtomicExpr::Cas {
                addr,
                expected,
                desired,
                success,
                failure,
                result,
            } => self
                .gen_cas(e, addr, expected, desired, *success, *failure, *result)
                .map(Some),
        }
    }

    fn gen_rmw(
        &mut self,
        object: &Type,
        op: RmwOp,
        op_ty: &Type,
        operand_ty: &Type,
        address: V,
        operand: V,
        order: u8,
        want_new: bool,
        loc: Loc,
    ) -> Res<V> {
        let kind = self.atomic_kind(object);
        let integral = |ty: &Type| ty.is_integer() || ty.is_ptr();
        let single = match op {
            RmwOp::Exchange => Some(bir::atomic_op::EXCHANGE),
            RmwOp::PtrAdd { sub, .. } => Some(if sub {
                bir::atomic_op::SUB
            } else {
                bir::atomic_op::ADD
            }),
            RmwOp::Arith(bop)
                if integral(object) && integral(op_ty) && !matches!(object, Type::Bool) =>
            {
                match bop {
                    BinOp::Add => Some(bir::atomic_op::ADD),
                    BinOp::Sub => Some(bir::atomic_op::SUB),
                    BinOp::And => Some(bir::atomic_op::AND),
                    BinOp::Or => Some(bir::atomic_op::OR),
                    BinOp::Xor => Some(bir::atomic_op::XOR),
                    _ => None,
                }
            }
            _ => None,
        };
        if let Some(code) = single {
            // Modular arithmetic: the low bits of the operand are all that matter.
            let raw_operand = match op {
                RmwOp::Exchange => self.atomic_bits(operand, object),
                RmwOp::PtrAdd { scale, .. } if scale != 1 => {
                    let s = self.b.const_i64(scale as i64);
                    self.b.bin(CBin::Mul, operand, s)
                }
                RmwOp::PtrAdd { .. } => operand,
                _ => {
                    let narrowed = self.convert(operand, operand_ty, object, loc)?;
                    self.atomic_bits(narrowed, object)
                }
            };
            let raw = self.b.def(
                Inst::AtomicRmw(code, kind, order, raw_operand, address),
                kind.value_ty(),
            );
            let old = self.atomic_value(raw, object);
            if !want_new {
                return Ok(old);
            }
            return self.rmw_result(op, old, operand, object, op_ty, loc);
        }

        // A compare-and-swap loop.
        let raw_ty = kind.value_ty();
        let object_mty = self.mty(object);
        let operand_mty = self.b.value_ty(operand);
        let (address_temp, operand_temp, seen_temp, new_temp) = (
            self.alloc_temp(Ty::I64),
            self.alloc_temp(operand_mty),
            self.alloc_temp(raw_ty),
            self.alloc_temp(object_mty),
        );
        self.b.effect(Inst::LocalSet(address_temp, address));
        self.b.effect(Inst::LocalSet(operand_temp, operand));
        let first = self
            .b
            .def(Inst::AtomicLoad(kind, bir::order::RELAXED, address), raw_ty);
        self.b.effect(Inst::LocalSet(seen_temp, first));
        let (retry, done) = (self.b.new_block(), self.b.new_block());
        self.b.terminate(Inst::Jump(retry));

        self.b.switch_to(retry);
        let seen = self.b.local_get(seen_temp);
        let old = self.atomic_value(seen, object);
        let operand = self.b.local_get(operand_temp);
        let new = self.rmw_result(op, old, operand, object, op_ty, loc)?;
        self.b.effect(Inst::LocalSet(new_temp, new));
        let new_bits = self.atomic_bits(new, object);
        let address = self.b.local_get(address_temp);
        let failure = match order {
            bir::order::SEQ_CST => bir::order::SEQ_CST,
            bir::order::ACQUIRE | bir::order::ACQ_REL => bir::order::ACQUIRE,
            _ => bir::order::RELAXED,
        };
        let found = self.b.def(
            Inst::AtomicCas(kind, order, failure, seen, new_bits, address),
            raw_ty,
        );
        self.b.effect(Inst::LocalSet(seen_temp, found));
        let swapped = self.b.bin(CBin::Eq, found, seen);
        self.b.terminate(Inst::Br(swapped, done, retry));

        self.b.switch_to(done);
        let result = if want_new {
            self.b.local_get(new_temp)
        } else {
            // On success the value found is the value that was replaced.
            let seen = self.b.local_get(seen_temp);
            self.atomic_value(seen, object)
        };
        self.free_temp(address_temp, Ty::I64);
        self.free_temp(operand_temp, operand_mty);
        self.free_temp(seen_temp, raw_ty);
        self.free_temp(new_temp, object_mty);
        Ok(result)
    }

    fn gen_cas(
        &mut self,
        e: &Expr,
        addr: &Expr,
        expected: &Expr,
        desired: &Expr,
        success: u8,
        failure: u8,
        result: CasResult,
    ) -> Res<V> {
        let object = &desired.ty;
        let kind = self.atomic_kind(object);
        let raw_ty = kind.value_ty();
        let address = self.gen_value(addr)?;
        let held_address = self.hold(
            address,
            expected.has_control_flow || desired.has_control_flow,
        );
        let expected_value = self.gen_value(expected)?;
        let held_expected = self.hold(expected_value, desired.has_control_flow);
        let desired_value = self.gen_value(desired)?;
        let expected_value = self.release(held_expected);
        let address = self.release(held_address);
        let desired_bits = self.atomic_bits(desired_value, object);
        let expected_bits = if result == CasResult::SuccessWriteBack {
            // `expected` is a pointer: the bytes it points at are compared as they are.
            self.b.load(kind, expected_value, 0)
        } else {
            self.atomic_bits(expected_value, object)
        };
        let found = self.b.def(
            Inst::AtomicCas(kind, success, failure, expected_bits, desired_bits, address),
            raw_ty,
        );
        let swapped = self.b.bin(CBin::Eq, found, expected_bits);
        match result {
            CasResult::Old => Ok(self.atomic_value(found, &e.ty)),
            CasResult::Success => Ok(swapped),
            CasResult::SuccessWriteBack => {
                let (pointer_temp, found_temp, swapped_temp) = (
                    self.alloc_temp(Ty::I64),
                    self.alloc_temp(raw_ty),
                    self.alloc_temp(Ty::I32),
                );
                self.b.effect(Inst::LocalSet(pointer_temp, expected_value));
                self.b.effect(Inst::LocalSet(found_temp, found));
                self.b.effect(Inst::LocalSet(swapped_temp, swapped));
                let (write_back, done) = (self.b.new_block(), self.b.new_block());
                self.b.terminate(Inst::Br(swapped, done, write_back));

                self.b.switch_to(write_back);
                let pointer = self.b.local_get(pointer_temp);
                let found = self.b.local_get(found_temp);
                self.b.effect(Inst::Store(kind, found, pointer, 0));
                self.b.terminate(Inst::Jump(done));

                self.b.switch_to(done);
                let swapped = self.b.local_get(swapped_temp);
                self.free_temp(pointer_temp, Ty::I64);
                self.free_temp(found_temp, raw_ty);
                self.free_temp(swapped_temp, Ty::I32);
                Ok(swapped)
            }
        }
    }

    /// Dispatches the expression kinds this module generates.
    pub(super) fn gen_simd_expr(&mut self, e: &Expr) -> Res<Option<V>> {
        match &e.kind {
            ExprKind::VecSplat(scalar) => self.gen_vec_splat(e, scalar).map(Some),
            ExprKind::VecInit(lanes) => self.gen_vec_init(e, lanes).map(Some),
            ExprKind::VecElem(base, index) => self.gen_lane_value(e, base, index).map(Some),
            ExprKind::VecBuiltin(op, args) => self.gen_vec_builtin(e, *op, args).map(Some),
            ExprKind::Atomic(atomic) => self.gen_atomic(e, atomic),
            _ => internal(e.loc, "not a vector or atomic expression"),
        }
    }
}

//! Scalar replacement of local aggregates: a local array or structure every use of which
//! names one of its scalar elements at a constant offset (or copies a whole range of them
//! with `memcpy`, `memset`, an assignment or an initializer) is not an object in memory at
//! all: each element is a BIR local of its own.
//!
//! `promotable_locals` decides, per function, which locals qualify; `FnGen` then resolves
//! an element access to its BIR local (`leaf_of`) and expands the range copies.

use super::{FnGen, LocalPlace, internal};
use crate::ast::*;
use crate::bir::{Inst, Ty, V};
use crate::constexpr::{self, Const};
use crate::token::{Loc, Res};
use crate::types::{Type, TypeCtx};

/// One scalar element of a replaced aggregate.
#[derive(Clone, Debug)]
pub(super) struct Leaf {
    pub(super) offset: u64,
    pub(super) ty: Type,
    /// The BIR local that holds it.
    pub(super) reg: u32,
}

const MAX_LEAVES: usize = 64;
const MAX_BYTES: u64 = 512;

/// The scalar elements of `ty` at `base`, in address order; `false` if it has a part that
/// cannot be a BIR local (a union, a bit-field, a 128-bit or complex or vector element).
fn flatten(tcx: &TypeCtx, ty: &Type, base: u64, out: &mut Vec<(u64, Type)>) -> bool {
    if ty.is_volatile() || ty.is_atomic() || out.len() > MAX_LEAVES {
        return false;
    }
    match ty.unqualified() {
        Type::Array(elem, Some(count)) => {
            let Some(size) = tcx.size_of(elem) else {
                return false;
            };
            if *count > MAX_LEAVES as u64 {
                return false;
            }
            (0..*count).all(|i| flatten(tcx, elem, base + i * size, out))
        }
        Type::Struct(id) => {
            let def = tcx.struct_def(*id);
            def.is_complete()
                && !def.is_union
                && def
                    .members()
                    .iter()
                    .all(|m| m.bitfield.is_none() && flatten(tcx, &m.ty, base + m.offset, out))
        }
        scalar => {
            let plain = (scalar.is_integer() && !scalar.is_int128())
                || scalar.is_float()
                || scalar.is_ptr();
            if plain {
                out.push((base, scalar.clone()));
            }
            plain
        }
    }
}

/// The local `e` is a part of, and where in it, when `e` is an lvalue reached from a
/// local variable through members and constant indices only.
pub(super) fn local_path(e: &Expr, tcx: &TypeCtx) -> Option<(LocalId, u64)> {
    match &e.kind {
        ExprKind::Local(id) => Some((*id, 0)),
        ExprKind::Member(base, offset) if base.is_lvalue() => {
            let (id, at) = local_path(base, tcx)?;
            Some((id, at.checked_add(*offset)?))
        }
        ExprKind::Deref(address) => {
            let (array, index) = match &address.kind {
                ExprKind::PtrAdd {
                    ptr,
                    index,
                    scale,
                    sub: false,
                } => {
                    let Ok(Const::Int(i)) = constexpr::eval(index, tcx) else {
                        return None;
                    };
                    (ptr, u64::try_from(i).ok()?.checked_mul(*scale)?)
                }
                _ => (address, 0),
            };
            let ExprKind::Decay(array) = &array.kind else {
                return None;
            };
            let (id, at) = local_path(array, tcx)?;
            let inside = index.checked_add(tcx.size_of(&e.ty)?)? <= tcx.size_of(&array.ty)?;
            inside.then_some((id, at.checked_add(index)?))
        }
        _ => None,
    }
}

/// `operand` as the address of (a part of) a local: `&part`, or an array part decayed,
/// possibly converted between pointer types.
fn address_of_local(operand: &Expr, tcx: &TypeCtx) -> Option<(LocalId, u64)> {
    let mut e = operand;
    while let ExprKind::Cast(inner) = &e.kind {
        if !e.ty.is_ptr() || !inner.ty.is_ptr() {
            return None;
        }
        e = inner;
    }
    match &e.kind {
        ExprKind::AddrOf(part) | ExprKind::Decay(part) if part.is_lvalue() => local_path(part, tcx),
        _ => None,
    }
}

struct Scan<'a> {
    tcx: &'a TypeCtx,
    /// Per local: its elements if it is still a candidate.
    leaves: Vec<Option<Vec<(u64, Type)>>>,
}

impl Scan<'_> {
    fn reject(&mut self, id: LocalId) {
        if let Some(slot) = self.leaves.get_mut(id as usize) {
            *slot = None;
        }
    }

    fn candidate(&self, id: LocalId) -> Option<&Vec<(u64, Type)>> {
        self.leaves.get(id as usize).and_then(Option::as_ref)
    }

    /// Whether the bytes `[from, from + bytes)` of candidate `id` are whole elements.
    fn covers_elements(&self, id: LocalId, from: u64, bytes: u64) -> bool {
        let Some(leaves) = self.candidate(id) else {
            return false;
        };
        let Some(end) = from.checked_add(bytes) else {
            return false;
        };
        let size = |ty: &Type| self.tcx.size_of(ty).unwrap_or(0);
        let starts = from == end || leaves.iter().any(|(at, _)| *at == from);
        let ends = from == end || leaves.iter().any(|(at, ty)| at + size(ty) == end);
        // No element straddles either boundary.
        let clean = leaves.iter().all(|(at, ty)| {
            let leaf_end = at + size(ty);
            leaf_end <= from || *at >= end || (*at >= from && leaf_end <= end)
        });
        starts && ends && clean && bytes > 0
    }

    /// An operand of a copy: if it is the address of a range of a candidate, check the
    /// range; anything else is an ordinary expression.
    fn copy_operand(&mut self, operand: &Expr, bytes: Option<u64>) {
        match address_of_local(operand, self.tcx) {
            Some((id, offset)) if self.candidate(id).is_some() => {
                let fine = bytes.is_some_and(|n| self.covers_elements(id, offset, n));
                if !fine {
                    self.reject(id);
                }
            }
            _ => self.expr(operand, false),
        }
    }

    fn expr(&mut self, e: &Expr, is_statement: bool) {
        // (Down a chain of operators by a loop.)
        let mut next = Some((e, is_statement));
        while let Some((e, is_statement)) = next {
            next = self.expr_here(e, is_statement);
        }
    }

    /// Looks at `e` and what is under it, but for its `spine_child`, which is handed back with
    /// what it is to be looked at as.
    fn expr_here<'e>(&mut self, e: &'e Expr, is_statement: bool) -> Option<(&'e Expr, bool)> {
        // A whole path from a local to something: an element, or a misuse.
        if let Some((id, offset)) = local_path(e, self.tcx) {
            let element = self.candidate(id).is_some_and(|leaves| {
                leaves
                    .iter()
                    .any(|(at, ty)| *at == offset && ty == e.ty.unqualified())
            });
            if !element {
                self.reject(id);
            }
            return None;
        }
        match &e.kind {
            ExprKind::Intrinsic(op @ (Intrinsic::MemCopy | Intrinsic::MemSet), args)
                if e.ty.is_void() =>
            {
                let [dst, second, n] = args.as_slice() else {
                    return None;
                };
                let bytes = match constexpr::eval(n, self.tcx) {
                    Ok(Const::Int(n)) => u64::try_from(n).ok(),
                    _ => None,
                };
                self.expr(n, false);
                if *op == Intrinsic::MemCopy {
                    self.copy_operand(dst, bytes);
                    self.copy_operand(second, bytes);
                } else {
                    // Only a constant byte can be spread over the elements.
                    let constant = matches!(constexpr::eval(second, self.tcx), Ok(Const::Int(_)));
                    self.copy_operand(dst, bytes.filter(|_| constant));
                    self.expr(second, false);
                }
            }
            // Assigning a whole structure, to or from a part of a candidate.
            ExprKind::Assign(lhs, rhs) if e.ty.is_struct() => {
                let bytes = self.tcx.size_of(&e.ty);
                match local_path(lhs, self.tcx) {
                    Some((id, offset)) if self.candidate(id).is_some() => {
                        // The value of the assignment would be the object's address.
                        let fine = is_statement
                            && bytes.is_some_and(|n| self.covers_elements(id, offset, n));
                        if !fine {
                            self.reject(id);
                        }
                    }
                    _ => self.expr(lhs, false),
                }
                match local_path(rhs, self.tcx) {
                    Some((id, offset)) if self.candidate(id).is_some() => {
                        if !bytes.is_some_and(|n| self.covers_elements(id, offset, n)) {
                            self.reject(id);
                        }
                    }
                    _ => self.expr(rhs, false),
                }
            }
            ExprKind::StmtExpr { stmts, result } => {
                for s in stmts {
                    self.stmt(s);
                }
                if let Some(result) = result {
                    self.expr(result, false);
                }
            }
            ExprKind::CompoundLiteral { local, items, .. } => {
                // A compound literal is an object whose address the expression is.
                self.reject(*local);
                self.items(None, items);
            }
            // The address of a part of a candidate is about to go somewhere.
            ExprKind::AddrOf(inner) | ExprKind::Decay(inner) => match local_path(inner, self.tcx) {
                Some((id, _)) => self.reject(id),
                None => self.expr(inner, false),
            },
            ExprKind::Comma(a, b) => {
                self.expr(b, is_statement);
                return Some((a, true));
            }
            ExprKind::Cast(inner) if e.ty.is_void() => self.expr(inner, true),
            _ => {
                let spine = e.spine_child();
                e.for_each_child(|c| {
                    if !spine.is_some_and(|next| std::ptr::eq(next, c)) {
                        self.expr(c, false);
                    }
                });
                return spine.map(|next| (next, false));
            }
        }
        None
    }

    /// The items of an initializer; `target` is the local they initialize.
    fn items(&mut self, target: Option<LocalId>, items: &[InitItem]) {
        for item in items {
            let range = match item {
                InitItem::Scalar { offset, expr } => {
                    self.expr(expr, false);
                    // Exactly one element, of that type.
                    let exact = target
                        .and_then(|id| self.candidate(id))
                        .is_some_and(|leaves| {
                            leaves
                                .iter()
                                .any(|(at, ty)| at == offset && ty == expr.ty.unqualified())
                        });
                    if let (Some(id), false) = (target, exact) {
                        self.reject(id);
                    }
                    continue;
                }
                InitItem::Copy { offset, expr, size } => {
                    match local_path(expr, self.tcx) {
                        Some((id, at)) if self.candidate(id).is_some() => {
                            if !self.covers_elements(id, at, *size) {
                                self.reject(id);
                            }
                        }
                        _ => self.expr(expr, false),
                    }
                    (*offset, *size)
                }
                InitItem::Bytes { offset, bytes } => (*offset, bytes.len() as u64),
                InitItem::Bits { expr, .. } => {
                    self.expr(expr, false);
                    if let Some(id) = target {
                        self.reject(id);
                    }
                    continue;
                }
            };
            if let Some(id) = target {
                if range.1 > 0 && !self.covers_elements(id, range.0, range.1) {
                    self.reject(id);
                }
            }
        }
    }

    fn stmt(&mut self, s: &Stmt) {
        match s {
            Stmt::Empty | Stmt::Goto(_) | Stmt::Break | Stmt::Continue | Stmt::Return(None) => {}
            Stmt::Expr(e) => self.expr(e, true),
            Stmt::Return(Some(e)) | Stmt::GotoComputed(e) => self.expr(e, false),
            Stmt::LocalInit { local, items, .. } => self.items(Some(*local), items),
            Stmt::Block(stmts) => stmts.iter().for_each(|s| self.stmt(s)),
            Stmt::If(c, then, other) => {
                self.expr(c, false);
                self.stmt(then);
                if let Some(other) = other {
                    self.stmt(other);
                }
            }
            Stmt::While(c, body) | Stmt::DoWhile(body, c) => {
                self.expr(c, false);
                self.stmt(body);
            }
            Stmt::For {
                init,
                cond,
                step,
                body,
            } => {
                if let Some(init) = init {
                    self.stmt(init);
                }
                if let Some(cond) = cond {
                    self.expr(cond, false);
                }
                if let Some(step) = step {
                    self.expr(step, true);
                }
                self.stmt(body);
            }
            Stmt::Switch { cond, body, .. } => {
                self.expr(cond, false);
                self.stmt(body);
            }
            Stmt::Label(_, body) => self.stmt(body),
            Stmt::VlaAlloc { local, size, .. } => {
                self.reject(*local);
                self.expr(size, false);
            }
            Stmt::VlaScope { cleanup, body, .. } => {
                if let Some(cleanup) = cleanup {
                    self.expr(cleanup, true);
                }
                body.iter().for_each(|s| self.stmt(s));
            }
        }
    }
}

/// For every local of `body`, its scalar elements if the local can be replaced by them.
pub(super) fn promotable_locals(body: &FuncBody, tcx: &TypeCtx) -> Vec<Option<Vec<(u64, Type)>>> {
    let leaves = body
        .locals
        .iter()
        .enumerate()
        .map(|(index, local)| {
            let aggregate = matches!(
                local.ty.unqualified(),
                Type::Array(_, Some(_)) | Type::Struct(_)
            );
            if !aggregate
                || local.volatile
                || body.params.contains(&(index as LocalId))
                || tcx
                    .size_of(&local.ty)
                    .is_none_or(|size| size == 0 || size > MAX_BYTES)
            {
                return None;
            }
            let mut out = Vec::new();
            (flatten(tcx, &local.ty, 0, &mut out) && !out.is_empty() && out.len() <= MAX_LEAVES)
                .then_some(out)
        })
        .collect();
    let mut scan = Scan { tcx, leaves };
    if scan.leaves.iter().any(Option::is_some) {
        for s in &body.stmts {
            scan.stmt(s);
        }
    }
    scan.leaves
}

impl FnGen<'_, '_> {
    fn leaves_of(&self, id: LocalId) -> Option<&[Leaf]> {
        match self.locals.get(id as usize) {
            Some(LocalPlace::Scalars(set)) => {
                self.scalar_sets.get(*set as usize).map(Vec::as_slice)
            }
            _ => None,
        }
    }

    /// The BIR local that is lvalue `e`, an element of a replaced aggregate.
    pub(super) fn leaf_of(&self, e: &Expr) -> Option<u32> {
        if !matches!(e.kind, ExprKind::Deref(_) | ExprKind::Member(..)) {
            return None;
        }
        let (id, offset) = local_path(e, self.tcx)?;
        self.leaves_of(id)?
            .iter()
            .find(|leaf| leaf.offset == offset && leaf.ty == *e.ty.unqualified())
            .map(|leaf| leaf.reg)
    }

    /// The elements of a replaced aggregate in `[offset, offset + bytes)` if `operand` is
    /// the address of that range.
    pub(super) fn leaves_at_address(&self, operand: &Expr, bytes: u64) -> Option<Vec<Leaf>> {
        let (id, offset) = address_of_local(operand, self.tcx)?;
        self.leaves_in(id, offset, bytes)
    }

    /// Likewise for an lvalue that is (a part of) a replaced aggregate.
    pub(super) fn leaves_of_object(&self, object: &Expr) -> Option<Vec<Leaf>> {
        let (id, offset) = local_path(object, self.tcx)?;
        self.leaves_in(id, offset, self.tcx.size_of(&object.ty)?)
    }

    fn leaves_in(&self, id: LocalId, offset: u64, bytes: u64) -> Option<Vec<Leaf>> {
        let end = offset.checked_add(bytes)?;
        Some(
            self.leaves_of(id)?
                .iter()
                .filter(|leaf| leaf.offset >= offset && leaf.offset < end)
                .map(|leaf| Leaf {
                    offset: leaf.offset - offset,
                    ..leaf.clone()
                })
                .collect(),
        )
    }

    /// Sets the elements `to` (offsets relative to the start of the copy) from memory at `from`.
    pub(super) fn load_leaves(&mut self, to: &[Leaf], from: V) {
        for leaf in to {
            let v = self
                .b
                .load(self.tcx.mem_kind(&leaf.ty, false), from, leaf.offset as i64);
            let v = self.normalize(v, &leaf.ty);
            self.b.effect(Inst::LocalSet(leaf.reg, v));
        }
    }

    /// Stores the elements `from` to memory at `to`.
    pub(super) fn store_leaves(&mut self, from: &[Leaf], to: V) {
        for leaf in from {
            let v = self.b.local_get(leaf.reg);
            let kind = self.tcx.mem_kind(&leaf.ty, true);
            self.b.effect(Inst::Store(kind, v, to, leaf.offset as i64));
        }
    }

    /// Element by element, for two ranges with the same layout.
    pub(super) fn move_leaves(&mut self, to: &[Leaf], from: &[Leaf], loc: Loc) -> Res<()> {
        // Read everything first: the ranges may be the same elements.
        let mut values = Vec::with_capacity(to.len());
        for target in to {
            let Some(source) = from.iter().find(|s| s.offset == target.offset) else {
                return internal(loc, "aggregates with different elements copied");
            };
            let v = self.b.local_get(source.reg);
            let (from_m, to_m) = (self.mty(&source.ty), self.mty(&target.ty));
            let v = if from_m == to_m {
                v
            } else if self.tcx.size_of(&source.ty) == self.tcx.size_of(&target.ty) {
                self.b.conv(crate::bir::ConvOp::Bitcast, to_m, v)
            } else {
                return internal(loc, "aggregates with different elements copied");
            };
            values.push(self.normalize(v, &target.ty));
        }
        for (target, v) in to.iter().zip(values) {
            self.b.effect(Inst::LocalSet(target.reg, v));
        }
        Ok(())
    }

    /// Every byte of the elements `to` becomes `byte`.
    pub(super) fn fill_leaves(&mut self, to: &[Leaf], byte: u8) {
        for leaf in to {
            let size = self.tcx.size_of(&leaf.ty).unwrap_or(0).min(8);
            let mut bits = 0u64;
            for k in 0..size {
                bits |= u64::from(byte) << (8 * k);
            }
            self.set_leaf_bits(leaf, bits);
        }
    }

    /// The element becomes the value whose object representation is the low bytes of `bits`.
    pub(super) fn set_leaf_bits(&mut self, leaf: &Leaf, bits: u64) {
        let size = self.tcx.size_of(&leaf.ty).unwrap_or(8).min(8);
        let v = match &leaf.ty {
            Type::Float => self.b.def(Inst::ConstF32(bits as u32), Ty::F32),
            Type::Double | Type::LongDouble64 => self.b.def(Inst::ConstF64(bits), Ty::F64),
            Type::Bool => self.b.const_i32(i32::from(bits & 0xff != 0)),
            ty => {
                let shift = 64 - size as u32 * 8;
                let value = if ty.is_integer() && self.tcx.is_signed(ty) {
                    ((bits << shift) as i64) >> shift
                } else if shift == 0 {
                    bits as i64
                } else {
                    (bits & ((1u64 << (size * 8)) - 1)) as i64
                };
                self.b.const_int(self.mty(ty), value)
            }
        };
        self.b.effect(Inst::LocalSet(leaf.reg, v));
    }

    /// The initializer of a replaced aggregate.
    pub(super) fn init_leaves(
        &mut self,
        local: LocalId,
        zero_first: bool,
        items: &[InitItem],
        loc: Loc,
    ) -> Res<()> {
        let Some(all) = self.leaves_of(local).map(<[Leaf]>::to_vec) else {
            return internal(loc, "initializer for an aggregate that was not replaced");
        };
        if zero_first {
            self.fill_leaves(&all, 0);
        }
        for item in items {
            match item {
                InitItem::Scalar { offset, expr } => {
                    let Some(leaf) = all.iter().find(|l| l.offset == *offset) else {
                        return internal(loc, "initializer for no element");
                    };
                    let v = self.gen_value(expr)?;
                    self.b.effect(Inst::LocalSet(leaf.reg, v));
                }
                InitItem::Bytes { offset, bytes } => {
                    let end = offset + bytes.len() as u64;
                    for leaf in all.iter().filter(|l| l.offset >= *offset && l.offset < end) {
                        let mut raw = [0u8; 8];
                        let start = (leaf.offset - offset) as usize;
                        for (k, slot) in raw.iter_mut().enumerate() {
                            *slot = bytes.get(start + k).copied().unwrap_or(0);
                        }
                        self.set_leaf_bits(leaf, u64::from_le_bytes(raw));
                    }
                }
                InitItem::Copy { offset, expr, size } => {
                    let end = offset + size;
                    let to: Vec<Leaf> = all
                        .iter()
                        .filter(|l| l.offset >= *offset && l.offset < end)
                        .map(|l| Leaf {
                            offset: l.offset - offset,
                            ..l.clone()
                        })
                        .collect();
                    match self.leaves_of_object(expr) {
                        Some(from) => self.move_leaves(&to, &from, loc)?,
                        None => {
                            let from = self.gen_value(expr)?;
                            self.load_leaves(&to, from);
                        }
                    }
                }
                InitItem::Bits { .. } => return internal(loc, "bit-field in a replaced aggregate"),
            }
        }
        Ok(())
    }
}

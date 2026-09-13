//! The portable ways of reading and writing a multi-byte integer one byte at a time,
//! turned back into one access:
//!
//! - `(u32)p[0] << 24 | (u32)p[1] << 16 | (u32)p[2] << 8 | p[3]` (any order, `|`, `+` or
//!   `^`, with whatever conversions and `& 0xff` in between) is one 4-byte load and a
//!   byte swap; the little-endian order is the load alone;
//! - `p[0] = (u8)(v >> 24); p[1] = (u8)(v >> 16); p[2] = (u8)(v >> 8); p[3] = (u8)v;` as
//!   adjacent statements (or comma operands) is one store.
//!
//! Runs of 2, 4 and 8 bytes are combined; the combined access touches exactly the bytes
//! the separate ones did, and every target here allows it unaligned. All targets are
//! little-endian.

use super::{FnGen, LocalPlace};
use crate::ast::*;
use crate::bir::{BinOp as CBin, Inst, MemKind, Ty, UnOp, V};
use crate::constexpr::{self, Const};
use crate::sema::builtin::same_pure;
use crate::token::Res;
use crate::types::Type;

/// What one byte of an integer value is known to be.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Byte {
    Zero,
    /// The byte at this offset from the base pointer.
    At(i64),
    Unknown,
}

/// The bytes read, as found by `FnGen::byte_run`.
pub(super) struct ByteRun<'e> {
    base: &'e Expr,
    first: i64,
    bytes: usize,
    big_endian: bool,
}

struct Reader<'g, 'e> {
    tcx: &'g crate::types::TypeCtx,
    base: Option<&'e Expr>,
}

impl<'e> Reader<'_, 'e> {
    fn width(&self, ty: &Type) -> Option<usize> {
        let ty = ty.unatomic();
        if !ty.is_integer() || ty.is_pair() || matches!(ty, Type::Bool) {
            return None;
        }
        self.tcx.size_of(ty).map(|s| s as usize)
    }

    fn constant(&self, e: &Expr) -> Option<i64> {
        match constexpr::eval(e, self.tcx) {
            Ok(Const::Int(v)) => Some(v),
            _ => None,
        }
    }

    /// `e` as one byte read through the common base: its offset.
    fn byte_load(&mut self, e: &'e Expr) -> Option<i64> {
        if e.ty.is_volatile() || e.ty.is_atomic() || self.tcx.size_of(&e.ty) != Some(1) {
            return None;
        }
        let ExprKind::Deref(address) = &e.kind else {
            return None;
        };
        let (pointer, offset) = match &address.kind {
            ExprKind::PtrAdd {
                ptr,
                index,
                scale: 1,
                sub,
            } => {
                let k = self.constant(index)?;
                (&**ptr, if *sub { k.checked_neg()? } else { k })
            }
            _ => (&**address, 0),
        };
        match self.base {
            Some(base) if same_pure(base, pointer) => {}
            Some(_) => return None,
            // `same_pure` of an expression with itself says whether it is pure at all.
            None if same_pure(pointer, pointer) => self.base = Some(pointer),
            None => return None,
        }
        Some(offset)
    }

    /// The bytes of `e`'s value, least significant first.
    fn bytes_of(&mut self, e: &'e Expr, depth: u32) -> Option<Vec<Byte>> {
        if depth > 64 {
            return None;
        }
        let width = self.width(&e.ty)?;
        if let Some(offset) = self.byte_load(e) {
            return Some(vec![Byte::At(offset)]);
        }
        match &e.kind {
            ExprKind::IntLit(0) => Some(vec![Byte::Zero; width]),
            ExprKind::Cast(inner) => {
                let mut bytes = self.bytes_of(inner, depth + 1)?;
                if bytes.len() < width {
                    // Widening copies the sign bit of a signed value.
                    let fill = match bytes.last() {
                        Some(Byte::Zero) | None => Byte::Zero,
                        Some(_) if !self.tcx.is_signed(inner.ty.unatomic()) => Byte::Zero,
                        Some(_) => Byte::Unknown,
                    };
                    bytes.resize(width, fill);
                } else {
                    bytes.truncate(width);
                }
                Some(bytes)
            }
            ExprKind::Binary(BinOp::Shl, value, amount) => {
                let by = usize::try_from(self.constant(amount)?).ok()?;
                if !by.is_multiple_of(8) {
                    return None;
                }
                let mut bytes = self.bytes_of(value, depth + 1)?;
                for _ in 0..(by / 8).min(width) {
                    bytes.insert(0, Byte::Zero);
                }
                bytes.truncate(width);
                Some(bytes)
            }
            ExprKind::Binary(BinOp::And, a, b) => {
                let (value, mask) = match (self.constant(a), self.constant(b)) {
                    (None, Some(mask)) => (a, mask),
                    (Some(mask), None) => (b, mask),
                    _ => return None,
                };
                let mut bytes = self.bytes_of(value, depth + 1)?;
                for (k, byte) in bytes.iter_mut().enumerate() {
                    match (mask >> (8 * k.min(7))) & 0xff {
                        0xff => {}
                        0 => *byte = Byte::Zero,
                        _ => return None,
                    }
                }
                Some(bytes)
            }
            // Nothing carries or clashes when at most one side has a byte at each place.
            ExprKind::Binary(BinOp::Or | BinOp::Add | BinOp::Xor, a, b) => {
                let x = self.bytes_of(a, depth + 1)?;
                let y = self.bytes_of(b, depth + 1)?;
                x.iter()
                    .zip(&y)
                    .map(|pair| match pair {
                        (Byte::Zero, other) | (other, Byte::Zero) => Some(*other),
                        _ => None,
                    })
                    .collect()
            }
            _ => None,
        }
    }
}

/// A byte written by one statement of a run: `base[offset] = byte `source_byte` of value`.
struct ByteStore<'e> {
    base: &'e Expr,
    offset: i64,
    value: &'e Expr,
    source_byte: usize,
}

impl FnGen<'_, '_> {
    /// Whether `e` is computed from register variables and constants alone: storing to
    /// memory cannot change it, and it has no side effects.
    fn register_pure(&self, e: &Expr) -> bool {
        match &e.kind {
            ExprKind::IntLit(_) => true,
            ExprKind::Local(id) => {
                matches!(self.locals.get(*id as usize), Some(LocalPlace::Reg(_)))
            }
            ExprKind::Cast(a) | ExprKind::Neg(a) | ExprKind::BitNot(a) => {
                !e.ty.is_void() && self.register_pure(a)
            }
            ExprKind::Binary(op, a, b) => {
                !matches!(op, BinOp::Div | BinOp::Rem)
                    && self.register_pure(a)
                    && self.register_pure(b)
            }
            ExprKind::PtrAdd { ptr, index, .. } => {
                self.register_pure(ptr) && self.register_pure(index)
            }
            // The address of something reached from such a pointer; nothing is loaded.
            ExprKind::AddrOf(object) | ExprKind::Decay(object) => self.address_pure(object),
            _ => false,
        }
    }

    fn address_pure(&self, lvalue: &Expr) -> bool {
        match &lvalue.kind {
            ExprKind::Deref(pointer) => self.register_pure(pointer),
            ExprKind::Member(base, _) => base.is_lvalue() && self.address_pure(base),
            _ => false,
        }
    }

    fn mentions_replaced(&self, e: &Expr) -> bool {
        let mut found = matches!(
            e.kind,
            ExprKind::Local(id) if matches!(self.locals.get(id as usize), Some(LocalPlace::Scalars(_)))
        );
        e.for_each_child(|c| found |= self.mentions_replaced(c));
        found
    }

    /// `e`, an `|`/`+`/`^` of shifted bytes, as one load: see the module's description.
    pub(super) fn byte_run<'e>(&self, e: &'e Expr) -> Option<ByteRun<'e>> {
        if e.has_control_flow {
            return None;
        }
        let mut reader = Reader {
            tcx: self.tcx,
            base: None,
        };
        let bytes = reader.bytes_of(e, 0)?;
        let base = reader.base?;
        // The elements of a replaced aggregate are not in memory.
        if self.mentions_replaced(base) {
            return None;
        }
        let count = bytes
            .iter()
            .take_while(|b| matches!(b, Byte::At(_)))
            .count();
        if !matches!(count, 2 | 4 | 8) || bytes[count..].iter().any(|b| *b != Byte::Zero) {
            return None;
        }
        let offsets: Vec<i64> = bytes[..count]
            .iter()
            .filter_map(|b| match b {
                Byte::At(k) => Some(*k),
                _ => None,
            })
            .collect();
        let ascending = offsets
            .windows_by_pairs()
            .all(|(a, b)| a.checked_add(1) == Some(b));
        let descending = offsets
            .windows_by_pairs()
            .all(|(a, b)| b.checked_add(1) == Some(a));
        let first = *offsets.iter().min()?;
        (ascending || descending).then_some(ByteRun {
            base,
            first,
            bytes: count,
            big_endian: descending,
        })
    }

    /// The value `run` reads, as `ty`.
    pub(super) fn gen_byte_run(&mut self, run: &ByteRun<'_>, ty: &Type) -> Res<V> {
        let base = self.gen_value(run.base)?;
        let kind = match run.bytes {
            2 => MemKind::I16U,
            4 => MemKind::I32,
            _ => MemKind::I64,
        };
        let mut v = self.b.load(kind, base, run.first);
        if run.big_endian {
            v = self.b.un(UnOp::Bswap, v);
            if run.bytes == 2 {
                let sixteen = self.b.const_i32(16);
                v = self.b.bin(CBin::ShrU, v, sixteen);
            }
        }
        Ok(match (self.b.value_ty(v), self.mty(ty)) {
            (Ty::I32, Ty::I64) => self.b.un(UnOp::ZExt32, v),
            _ => v,
        })
    }

    /// `e` as `base[constant] = one byte of value`.
    fn byte_store<'e>(&self, e: &'e Expr) -> Option<ByteStore<'e>> {
        let ExprKind::Assign(lhs, rhs) = &e.kind else {
            return None;
        };
        if lhs.ty.is_volatile() || lhs.ty.is_atomic() || self.tcx.size_of(&lhs.ty) != Some(1) {
            return None;
        }
        if !lhs.ty.unatomic().is_integer() || matches!(lhs.ty.unatomic(), Type::Bool) {
            return None;
        }
        let ExprKind::Deref(address) = &lhs.kind else {
            return None;
        };
        let constant = |e: &Expr| match constexpr::eval(e, self.tcx) {
            Ok(Const::Int(v)) => Some(v),
            _ => None,
        };
        let (base, offset) = match &address.kind {
            ExprKind::PtrAdd {
                ptr,
                index,
                scale: 1,
                sub,
            } => {
                let k = constant(index)?;
                (&**ptr, if *sub { k.checked_neg()? } else { k })
            }
            _ => (&**address, 0),
        };
        // The value: conversions and `& 0xff` around `value >> 8k`.
        let mut value: &Expr = rhs;
        loop {
            match &value.kind {
                ExprKind::Cast(inner)
                    if value.ty.is_integer()
                        && inner.ty.is_integer()
                        && !inner.ty.is_pair()
                        && !matches!(value.ty.unatomic(), Type::Bool) =>
                {
                    value = inner;
                }
                ExprKind::Binary(BinOp::And, a, b) if constant(b) == Some(0xff) => value = a,
                ExprKind::Binary(BinOp::And, a, b) if constant(a) == Some(0xff) => value = b,
                _ => break,
            }
        }
        let (value, shift) = match &value.kind {
            ExprKind::Binary(BinOp::Shr, v, by) => (&**v, constant(by)?),
            _ => (value, 0),
        };
        // Conversions under the shift must not have dropped the byte that is taken.
        let width = self.tcx.size_of(&value.ty)? as i64;
        if !value.ty.is_integer() || value.ty.is_pair() || shift < 0 || shift % 8 != 0 {
            return None;
        }
        if shift / 8 >= width || !self.register_pure(base) || !self.register_pure(value) {
            return None;
        }
        Some(ByteStore {
            base,
            offset,
            value,
            source_byte: (shift / 8) as usize,
        })
    }

    /// Generates the expression statements `items` (values discarded), combining runs of
    /// byte stores.
    fn gen_discarded(&mut self, items: &[&Expr]) -> Res<()> {
        let mut at = 0;
        while at < items.len() {
            let mut combined = false;
            for bytes in [8usize, 4, 2] {
                if at + bytes > items.len() {
                    continue;
                }
                let run: Option<Vec<ByteStore<'_>>> = items[at..at + bytes]
                    .iter()
                    .map(|e| self.byte_store(e))
                    .collect();
                let Some(run) = run else { continue };
                let first = &run[0];
                let same = run.iter().all(|s| {
                    same_pure(s.base, first.base)
                        && same_pure(s.value, first.value)
                        && s.value.ty == first.value.ty
                });
                let lowest = run.iter().map(|s| s.offset).min().unwrap_or(0);
                // Byte i of the value goes to offset lowest + i, or to the mirror image.
                let little = run
                    .iter()
                    .all(|s| s.offset.checked_sub(lowest) == Some(s.source_byte as i64));
                let big = run.iter().all(|s| {
                    s.offset.checked_sub(lowest)
                        == Some((bytes - 1 - s.source_byte.min(bytes - 1)) as i64)
                        && s.source_byte < bytes
                });
                let mut seen = vec![false; bytes];
                let distinct = run.iter().all(|s| {
                    s.source_byte < bytes && !std::mem::replace(&mut seen[s.source_byte], true)
                });
                if !same || !distinct || !(little || big) {
                    continue;
                }
                let base = self.gen_value(first.base)?;
                let held = self.hold(base, first.value.has_control_flow);
                let v = self.gen_value(first.value)?;
                let base = self.release(held);
                let (kind, mut v) = match bytes {
                    8 if self.b.value_ty(v) == Ty::I64 => (MemKind::I64, v),
                    8 => continue,
                    4 => (MemKind::I32, self.low_word(v)),
                    _ => (MemKind::I16U, self.low_word(v)),
                };
                if big {
                    v = self.b.un(UnOp::Bswap, v);
                    if bytes == 2 {
                        let sixteen = self.b.const_i32(16);
                        v = self.b.bin(CBin::ShrU, v, sixteen);
                    }
                }
                self.b.effect(Inst::Store(kind, v, base, lowest));
                at += bytes;
                combined = true;
                break;
            }
            if !combined {
                self.gen_discard(items[at])?;
                at += 1;
            }
        }
        Ok(())
    }

    /// Generates a list of statements, looking at adjacent expression statements together.
    pub(super) fn gen_stmts(&mut self, stmts: &[Stmt], loc: crate::token::Loc) -> Res<()> {
        fn flatten<'e>(e: &'e Expr, out: &mut Vec<&'e Expr>) {
            match &e.kind {
                ExprKind::Comma(a, b) => {
                    flatten(a, out);
                    flatten(b, out);
                }
                ExprKind::Cast(inner) if e.ty.is_void() => flatten(inner, out),
                _ => out.push(e),
            }
        }
        let mut at = 0;
        while at < stmts.len() {
            let mut items: Vec<&Expr> = Vec::new();
            let mut end = at;
            while let Some(Stmt::Expr(e)) = stmts.get(end) {
                flatten(e, &mut items);
                end += 1;
            }
            if items.len() >= 2 {
                self.gen_discarded(&items)?;
                at = end;
            } else {
                self.gen_stmt(&stmts[at], loc)?;
                at += 1;
            }
        }
        Ok(())
    }
}

/// Adjacent pairs of a slice.
trait Pairs {
    fn windows_by_pairs(&self) -> impl Iterator<Item = (i64, i64)>;
}

impl Pairs for Vec<i64> {
    fn windows_by_pairs(&self) -> impl Iterator<Item = (i64, i64)> {
        self.iter().zip(self.iter().skip(1)).map(|(a, b)| (*a, *b))
    }
}

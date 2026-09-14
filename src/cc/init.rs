//! Initializers: the parsed brace tree, and its elaboration against the type being
//! initialized (C11 6.7.9) into a flat list of writes at byte offsets.

use std::rc::Rc;

use crate::ast::*;
use crate::constexpr::{self, AddrBase, Const};
use crate::sema::Sema;
use crate::token::{Loc, Res, err};
use crate::types::Type;

#[derive(Clone)]
pub(crate) enum Designator {
    Field(Rc<str>, Loc),
    Index(u64, Loc),
    /// GNU C `[first ... last]`: the initializer is repeated for every index.
    Range(u64, u64, Loc),
}

#[derive(Clone)]
pub(crate) enum Init {
    Expr(Expr),
    List(Vec<InitEntry>, Loc),
}

/// The most elements the range designators of one brace list may add up to.
const MAX_RANGE_ELEMENTS: u64 = 1 << 22;

impl Sema {
    /// Replaces every entry that has a range designator by one entry per index.
    fn expand_ranges(&self, entries: Vec<InitEntry>) -> Res<Vec<InitEntry>> {
        let has_range = |e: &InitEntry| {
            e.designators
                .iter()
                .any(|d| matches!(d, Designator::Range(..)))
        };
        if !entries.iter().any(has_range) {
            return Ok(entries);
        }
        let mut out = Vec::with_capacity(entries.len());
        let mut budget = MAX_RANGE_ELEMENTS;
        for entry in entries {
            let Some(at) = entry
                .designators
                .iter()
                .position(|d| matches!(d, Designator::Range(..)))
            else {
                out.push(entry);
                continue;
            };
            let Designator::Range(first, last, loc) = entry.designators[at] else {
                continue;
            };
            let count = last - first + 1;
            if count > budget {
                return err(loc, "range designators initialize too many elements");
            }
            budget -= count;
            // The first element evaluates the initializer into the temporary; the others read it.
            let (first_init, other_init) = match (&entry.init, entry.once) {
                (Init::Expr(e), Some(local)) => {
                    let ty = self.rvalue_type(&e.ty);
                    let value = self.rvalue(e.clone())?;
                    let target = self.mk(ExprKind::Local(local), ty.clone(), e.loc)?;
                    let store = self.mk(
                        ExprKind::Assign(Box::new(target), Box::new(value)),
                        ty.clone(),
                        e.loc,
                    )?;
                    let read = self.mk(ExprKind::Local(local), ty, e.loc)?;
                    (Init::Expr(store), Init::Expr(read))
                }
                _ => (entry.init.clone(), entry.init.clone()),
            };
            let mut copies = Vec::with_capacity(count as usize);
            for index in first..=last {
                let mut designators = entry.designators.clone();
                designators[at] = Designator::Index(index, loc);
                copies.push(InitEntry {
                    designators,
                    init: if copies.is_empty() {
                        first_init.clone()
                    } else {
                        other_init.clone()
                    },
                    loc: entry.loc,
                    once: None,
                });
            }
            // A path can hold more than one range.
            out.extend(self.expand_ranges(copies)?);
        }
        Ok(out)
    }
}

#[derive(Clone)]
pub(crate) struct InitEntry {
    pub(crate) designators: Vec<Designator>,
    pub(crate) init: Init,
    pub(crate) loc: Loc,
    /// For a range designator whose initializer is not a constant: the unnamed local that
    /// holds its value, so that it is evaluated once.
    pub(crate) once: Option<LocalId>,
}

/// Objects larger than this are rejected; it bounds what a hostile designator such as
/// `[0x7fffffff] = 1` can make the compiler allocate.
pub(crate) const MAX_OBJECT_SIZE: u64 = 1 << 28;

fn is_char_type(ty: &Type) -> bool {
    matches!(ty.unatomic(), Type::Char | Type::SChar | Type::UChar)
}

/// Whether string literal `e` can initialize an array of type `ty`: a narrow string for a
/// character array, a wide string for an integer array with elements of the same size.
fn string_initializes(sema: &Sema, ty: &Type, e: &Expr) -> bool {
    let (Type::Array(elem, _), ExprKind::StrLit(_), Type::Array(lit_elem, _)) =
        (ty, &e.kind, &e.ty)
    else {
        return false;
    };
    if is_char_type(lit_elem) {
        return is_char_type(elem);
    }
    elem.is_integer() && !is_char_type(elem) && sema.tcx.size_of(elem) == sema.tcx.size_of(lit_elem)
}

fn is_aggregate(ty: &Type) -> bool {
    ty.is_array() || ty.is_struct()
}

impl Sema {
    /// Elaborates `init` for an object of type `ty`. Returns the (possibly completed) type
    /// and the writes to perform, in source order.
    pub(crate) fn elaborate_init(
        &self,
        ty: &Type,
        init: Init,
        loc: Loc,
    ) -> Res<(Type, Vec<InitItem>)> {
        let mut out = Vec::new();
        self.flexible_end.set(0);
        let count = self.init_object(ty, 0, init, &mut out)?;
        let ty = match ty {
            Type::Array(elem, None) => Type::Array(Rc::clone(elem), Some(count)),
            other => other.clone(),
        };
        match self.tcx.size_of(&ty) {
            Some(size) if size <= MAX_OBJECT_SIZE => Ok((ty, out)),
            Some(_) => err(loc, "object is too large"),
            None => err(
                loc,
                format!(
                    "cannot initialize incomplete type '{}'",
                    self.tcx.display(&ty)
                ),
            ),
        }
    }

    /// Initializes the object of type `ty` at `offset` from `init`. For arrays, returns the
    /// number of elements the initializer covers.
    fn init_object(&self, ty: &Type, offset: u64, init: Init, out: &mut Vec<InitItem>) -> Res<u64> {
        // Initialization is not an atomic operation.
        let ty = ty.unatomic();
        match init {
            Init::Expr(e) => self.init_from_expr(ty, offset, e, out),
            Init::List(entries, list_loc) if ty.is_vector() => {
                // `{ v }` with a vector of the same type, otherwise one scalar per lane.
                let mut lanes = Vec::with_capacity(entries.len());
                let single = entries.len() == 1;
                for entry in entries {
                    if !entry.designators.is_empty() {
                        return err(entry.loc, "designator in a vector initializer");
                    }
                    let Init::Expr(e) = entry.init else {
                        return err(entry.loc, "braces around a vector element initializer");
                    };
                    if single && e.ty.is_vector() {
                        return self.init_from_expr(ty, offset, e, out);
                    }
                    lanes.push(e);
                }
                let expr = self.vec_from_list(ty, lanes, list_loc)?;
                out.push(InitItem::Scalar { offset, expr });
                Ok(0)
            }
            Init::List(entries, list_loc) => {
                let mut entries = self.expand_ranges(entries)?;
                if ty.is_scalar() || ty.is_complex() {
                    let mut entries = entries.into_iter();
                    let Some(first) = entries.next() else {
                        return Ok(0);
                    };
                    if !first.designators.is_empty() {
                        return err(first.loc, "designator in initializer for a scalar");
                    }
                    if let Some(extra) = entries.next() {
                        return err(extra.loc, "excess elements in scalar initializer");
                    }
                    return self.init_object(ty, offset, first.init, out);
                }
                let is_braced_string = entries.len() == 1
                    && entries[0].designators.is_empty()
                    && matches!(&entries[0].init, Init::Expr(e) if string_initializes(self, ty, e));
                if is_braced_string {
                    if let Some(InitEntry {
                        init: Init::Expr(e),
                        ..
                    }) = entries.pop()
                    {
                        return self.init_from_expr(ty, offset, e, out);
                    }
                }
                if !is_aggregate(ty) {
                    return err(
                        list_loc,
                        format!(
                            "cannot initialize '{}' with a brace list",
                            self.tcx.display(ty)
                        ),
                    );
                }
                // A brace list initializes the whole sub-object: what an earlier designator gave
                // any part of it is overridden, mentioned again or not (C11 6.7.9p19).
                if let Some(size) = self.tcx.size_of(ty) {
                    out.retain(|item| {
                        let at = match item {
                            InitItem::Scalar { offset, .. }
                            | InitItem::Bytes { offset, .. }
                            | InitItem::Copy { offset, .. }
                            | InitItem::Bits { offset, .. } => *offset,
                        };
                        at < offset || at >= offset + size
                    });
                }
                let mut pos = 0;
                let count = self.init_list(ty, offset, &mut entries, &mut pos, true, 0, out)?;
                Ok(count)
            }
        }
    }

    fn init_from_expr(&self, ty: &Type, offset: u64, e: Expr, out: &mut Vec<InitItem>) -> Res<u64> {
        let loc = e.loc;
        let ty = ty.unatomic();
        if ty.is_value() {
            let expr = self.assign_convert(e, ty, loc, "initializing")?;
            out.push(InitItem::Scalar { offset, expr });
            return Ok(0);
        }
        // 128-bit integers, complex numbers and `long double`s are copied like small structs.
        if ty.is_pair() || ty.is_long_double() {
            let expr = self.assign_convert(e, ty, loc, "initializing")?;
            let size = self.tcx.size_of(ty).unwrap_or(0);
            out.push(InitItem::Copy { offset, expr, size });
            return Ok(0);
        }
        if let (Type::Array(elem, len), ExprKind::StrLit(id)) = (ty, &e.kind) {
            if string_initializes(self, ty, &e) {
                // The stored literal ends with its terminator; whether that fits is decided here.
                let esize = self.tcx.size_of(elem).unwrap_or(1).max(1);
                let stored = &self.strings[*id as usize];
                let bytes = &stored[..stored.len().saturating_sub(esize as usize)];
                let n = bytes.len() as u64 / esize;
                let mut data = bytes.to_vec();
                let count = match len {
                    Some(len) => {
                        // A constraint violation that GCC, Clang and Microsoft C all let pass with
                        // a warning, keeping the characters that fit.
                        if n > *len {
                            self.warnings.borrow_mut().push((
                                loc,
                                "initializer string is too long for the array".to_string(),
                            ));
                            data.truncate((*len * esize) as usize);
                        }
                        *len
                    }
                    None => n + 1,
                };
                if n < count {
                    data.extend(std::iter::repeat_n(0u8, esize as usize));
                }
                out.push(InitItem::Bytes {
                    offset,
                    bytes: data,
                });
                return Ok(count);
            }
        }
        if ty.is_struct() && e.ty.unatomic() == ty.unatomic() {
            let size = self.tcx.size_of(ty).unwrap_or(0);
            out.push(InitItem::Copy {
                offset,
                expr: e,
                size,
            });
            return Ok(0);
        }
        if let Type::Wide(kind) = ty {
            return err(
                loc,
                format!(
                    "computing with values of type '{}' is not supported yet",
                    kind.name()
                ),
            );
        }
        err(
            loc,
            format!(
                "cannot initialize '{}' with an expression of type '{}'",
                self.tcx.display(ty),
                self.tcx.display(&e.ty)
            ),
        )
    }

    /// Index of the member that is, or (through anonymous members) contains, `name`.
    /// The bool is true for a direct match.
    fn member_index(&self, ty: &Type, name: &str) -> Option<(u64, bool)> {
        let Type::Struct(id) = ty else { return None };
        for (i, m) in self.tcx.struct_def(*id).members.iter().enumerate() {
            match &m.name {
                Some(n) if &**n == name => return Some((i as u64, true)),
                Some(_) => {}
                None => {
                    if let Type::Struct(inner) = &m.ty {
                        if self.tcx.find_member(*inner, name).is_some() {
                            return Some((i as u64, false));
                        }
                    }
                }
            }
        }
        None
    }

    /// Fills sub-objects of aggregate `ty` from `entries[*pos..]`.
    ///
    /// `braced` is true when `entries` is this aggregate's own brace list; false when the
    /// braces were elided (or a designator path descended here), in which case only as
    /// many entries as the aggregate has sub-objects are consumed. `desig_skip` is how many
    /// designators of the first entry were already resolved by enclosing aggregates.
    fn init_list(
        &self,
        ty: &Type,
        base: u64,
        entries: &mut Vec<InitEntry>,
        pos: &mut usize,
        braced: bool,
        desig_skip: usize,
        out: &mut Vec<InitItem>,
    ) -> Res<u64> {
        let limit: Option<u64> = match ty {
            Type::Array(_, len) => *len,
            Type::Struct(id) => {
                let def = self.tcx.struct_def(*id);
                Some(if def.is_union {
                    def.members.len().min(1) as u64
                } else {
                    def.members.len() as u64
                })
            }
            _ => Some(0),
        };
        let mut cur: u64 = 0;
        let mut max: u64 = 0;
        let mut first = true;
        while *pos < entries.len() {
            let entry = &entries[*pos];
            let entry_loc = entry.loc;
            let skip = if first {
                desig_skip.min(entry.designators.len())
            } else {
                0
            };
            let ndesignators = entry.designators.len();
            // How many designators have been resolved once this level has chosen `cur`.
            let mut resolved = skip;
            if skip < ndesignators {
                if !braced && !first {
                    break;
                }
                match (&entry.designators[skip], ty) {
                    (Designator::Field(name, dloc), Type::Struct(_)) => match self
                        .member_index(ty, name)
                    {
                        Some((i, direct)) => {
                            cur = i;
                            if direct {
                                resolved += 1;
                            }
                        }
                        None => {
                            return err(
                                *dloc,
                                format!("no member named '{name}' in '{}'", self.tcx.display(ty)),
                            );
                        }
                    },
                    (Designator::Index(i, dloc), Type::Array(_, len)) => {
                        if len.is_some_and(|len| *i >= len) {
                            return err(*dloc, "array designator index exceeds the array bounds");
                        }
                        cur = *i;
                        resolved += 1;
                    }
                    (Designator::Field(_, dloc), _) => {
                        return err(*dloc, "field designator used for a non-struct type");
                    }
                    (Designator::Range(_, _, dloc), _) => {
                        return err(*dloc, "internal error: unexpanded range designator");
                    }
                    (Designator::Index(_, dloc), _) => {
                        return err(*dloc, "array designator used for a non-array type");
                    }
                }
            } else if limit.is_some_and(|n| cur >= n) {
                if braced {
                    return err(entry_loc, "excess elements in initializer");
                }
                break;
            }
            first = false;

            // A bit-field member takes one scalar initializer.
            if let Type::Struct(id) = ty {
                let m = &self.tcx.struct_def(*id).members[cur as usize];
                if let Some(field) = m.bitfield {
                    if resolved < ndesignators {
                        return err(entry_loc, "designator refers into a non-aggregate");
                    }
                    let (member_ty, offset) = (m.ty.clone(), base + m.offset);
                    let mut init = std::mem::replace(
                        &mut entries[*pos].init,
                        Init::List(Vec::new(), entry_loc),
                    );
                    *pos += 1;
                    // `{ 1 }` around a scalar is allowed.
                    while let Init::List(mut inner, list_loc) = init {
                        if inner.len() != 1 || !inner[0].designators.is_empty() {
                            return err(list_loc, "invalid initializer for a bit-field");
                        }
                        init = inner.remove(0).init;
                    }
                    let Init::Expr(e) = init else {
                        return err(entry_loc, "invalid initializer for a bit-field");
                    };
                    let loc = e.loc;
                    let expr = self.assign_convert(e, &member_ty, loc, "initializing")?;
                    out.push(InitItem::Bits {
                        offset,
                        field,
                        expr,
                    });
                    cur += 1;
                    max = max.max(cur);
                    continue;
                }
            }
            let (sub_ty, sub_off) = match ty {
                Type::Array(elem, _) => {
                    let Some(esize) = self.tcx.size_of(elem) else {
                        return err(entry_loc, "array has incomplete element type");
                    };
                    let off = cur.checked_mul(esize).and_then(|o| o.checked_add(base));
                    match off {
                        Some(off) if off <= MAX_OBJECT_SIZE => ((**elem).clone(), off),
                        _ => return err(entry_loc, "object is too large"),
                    }
                }
                Type::Struct(id) => {
                    let m = &self.tcx.struct_def(*id).members[cur as usize];
                    (m.ty.clone(), base + m.offset)
                }
                _ => return err(entry_loc, "invalid initializer"),
            };
            let sub_ty = sub_ty.unatomic().clone();
            // GNU C: a flexible array member of an object with static storage duration can
            // be initialized; the object grows by what the initializer needs.
            let flexible_elem = match &sub_ty {
                Type::Array(elem, None) => self.tcx.size_of(elem),
                _ => None,
            };
            if flexible_elem.is_none() && !self.tcx.is_complete(&sub_ty) {
                return err(entry_loc, "initializer for a member of incomplete type");
            }

            let before = *pos;
            if resolved < ndesignators {
                if !is_aggregate(&sub_ty) {
                    return err(entry_loc, "designator refers into a non-aggregate");
                }
                let count = self.init_list(&sub_ty, sub_off, entries, pos, false, resolved, out)?;
                if let Some(esize) = flexible_elem {
                    let end = count.saturating_mul(esize).saturating_add(sub_off);
                    if end > MAX_OBJECT_SIZE {
                        return err(entry_loc, "object is too large");
                    }
                    self.flexible_end.set(self.flexible_end.get().max(end));
                }
            } else {
                let direct = match &entries[*pos].init {
                    Init::List(..) => true,
                    Init::Expr(e) => {
                        sub_ty.is_scalar()
                            || sub_ty.is_complex()
                            || (sub_ty.is_vector() && e.ty.is_vector())
                            || string_initializes(self, &sub_ty, e)
                            || (sub_ty.is_struct() && *e.ty.unatomic() == sub_ty)
                    }
                };
                let count = if direct {
                    let init = std::mem::replace(
                        &mut entries[*pos].init,
                        Init::List(Vec::new(), entry_loc),
                    );
                    *pos += 1;
                    self.init_object(&sub_ty, sub_off, init, out)?
                } else if is_aggregate(&sub_ty) {
                    // Brace elision: the sub-aggregate takes entries from the same list.
                    self.init_list(&sub_ty, sub_off, entries, pos, false, ndesignators, out)?
                } else {
                    return err(entry_loc, "invalid initializer");
                };
                if let Some(esize) = flexible_elem {
                    let end = count.saturating_mul(esize).saturating_add(sub_off);
                    if end > MAX_OBJECT_SIZE {
                        return err(entry_loc, "object is too large");
                    }
                    self.flexible_end.set(self.flexible_end.get().max(end));
                }
            }
            if *pos == before {
                return err(entry_loc, "excess elements in initializer");
            }
            cur += 1;
            max = max.max(cur);
        }
        Ok(max)
    }

    /// Turns an elaborated initializer of an object with static storage duration into
    /// bytes plus relocations. Every expression must be a constant.
    pub(crate) fn static_init_data(
        &self,
        ty: &Type,
        items: &[InitItem],
        thread_local: bool,
        loc: Loc,
    ) -> Res<(Vec<u8>, Vec<DataReloc>)> {
        let Some(size) = self.tcx.size_of(ty) else {
            return err(loc, "initializer for an incomplete type");
        };
        let size = size.max(self.flexible_end.get());
        let mut bytes = vec![0u8; size as usize];
        let mut relocs: Vec<DataReloc> = Vec::new();
        for item in items {
            match item {
                InitItem::Scalar { offset, expr } => {
                    let width = self.tcx.size_of(&expr.ty).unwrap_or(0);
                    let start = *offset as usize;
                    let end = start + width as usize;
                    if end > bytes.len() {
                        return err(expr.loc, "initializer writes outside the object");
                    }
                    // A later initializer for the same bytes replaces an earlier one.
                    relocs.retain(|r| r.offset + 8 <= *offset || r.offset >= offset + width);
                    if expr.ty.is_vector() {
                        let Some(lanes) = self.const_vector_bytes(expr) else {
                            return err(
                                expr.loc,
                                "initializer element is not a compile-time constant",
                            );
                        };
                        bytes[start..end].copy_from_slice(&lanes[..width as usize]);
                        continue;
                    }
                    let value = match constexpr::eval(expr, &self.tcx) {
                        Ok(v) => v,
                        Err(_) => {
                            // `int x = (int){44};`: the value of a file-scope compound
                            // literal is what it was initialized with (GNU extension).
                            let mut source = expr;
                            while let ExprKind::Cast(inner) = &source.kind {
                                if inner.ty.unqualified() != source.ty.unqualified() {
                                    break;
                                }
                                source = inner;
                            }
                            let literal = match source.kind {
                                ExprKind::Global(id) => self.globals.get(id as usize).filter(|g| {
                                    g.has_initializer
                                        && g.name.starts_with(".compound_literal.")
                                        && g.init.len() <= width as usize
                                        && self.tcx.size_of(&g.ty) == Some(width)
                                }),
                                _ => None,
                            };
                            let Some(literal) = literal else {
                                return err(
                                    expr.loc,
                                    "initializer element is not a compile-time constant",
                                );
                            };
                            // (Trailing zero bytes are not stored.)
                            bytes[start..end].fill(0);
                            bytes[start..start + literal.init.len()].copy_from_slice(&literal.init);
                            for r in &literal.relocs {
                                relocs.push(DataReloc {
                                    offset: offset + r.offset,
                                    target: r.target.clone(),
                                    addend: r.addend,
                                });
                            }
                            continue;
                        }
                    };
                    match value {
                        Const::Int(v) => {
                            bytes[start..end].copy_from_slice(&v.to_le_bytes()[..width as usize])
                        }
                        Const::Float(v) => {
                            if matches!(expr.ty, Type::Float) {
                                bytes[start..end]
                                    .copy_from_slice(&(v as f32).to_bits().to_le_bytes());
                            } else {
                                bytes[start..end].copy_from_slice(&v.to_bits().to_le_bytes());
                            }
                        }
                        Const::LongDouble(_) => {
                            return err(
                                expr.loc,
                                "initializer element is not a compile-time constant",
                            );
                        }
                        Const::Addr {
                            base,
                            offset: addend,
                        } => {
                            if width != 8 {
                                return err(
                                    expr.loc,
                                    "an address does not fit in this initializer's type",
                                );
                            }
                            bytes[start..end].fill(0);
                            if let AddrBase::Global(id) = base {
                                // Every thread has its own copy of a thread-local object:
                                // only another thread-local object can start out pointing
                                // at one (at its own thread's).
                                if !thread_local
                                    && self
                                        .globals
                                        .get(id as usize)
                                        .is_some_and(|g| g.thread_local)
                                {
                                    return err(
                                        expr.loc,
                                        "the address of a thread-local object is not a constant",
                                    );
                                }
                            }
                            let target = match base {
                                AddrBase::Global(id) => RelocTarget::Global(id),
                                AddrBase::Func(id) => RelocTarget::Func(id),
                                AddrBase::Str(id) => RelocTarget::Str(id),
                            };
                            relocs.push(DataReloc {
                                offset: *offset,
                                target,
                                addend,
                            });
                        }
                    }
                }
                InitItem::Bytes {
                    offset,
                    bytes: data,
                } => {
                    let start = *offset as usize;
                    let end = start + data.len();
                    if end > bytes.len() {
                        return err(loc, "initializer writes outside the object");
                    }
                    relocs.retain(|r| r.offset + 8 <= *offset || r.offset >= end as u64);
                    bytes[start..end].copy_from_slice(data);
                }
                InitItem::Copy { offset, expr, size }
                    if expr.ty.is_pair() || expr.ty.is_long_double() =>
                {
                    let start = *offset as usize;
                    let end = start + *size as usize;
                    if end > bytes.len() {
                        return err(expr.loc, "initializer writes outside the object");
                    }
                    let not_constant = || -> Res<(Vec<u8>, Vec<DataReloc>)> {
                        err(
                            expr.loc,
                            "initializer element is not a compile-time constant",
                        )
                    };
                    relocs.retain(|r| r.offset + 8 <= *offset || r.offset >= end as u64);
                    if expr.ty.is_int128() {
                        let Some(v) = constexpr::eval_int128(expr, &self.tcx) else {
                            return not_constant();
                        };
                        bytes[start..end].copy_from_slice(&v.to_le_bytes());
                    } else if expr.ty.is_long_double() {
                        let Ok(Const::LongDouble(v)) = constexpr::eval(expr, &self.tcx) else {
                            return err(
                                expr.loc,
                                "a 'long double' initializer that is not a constant this compiler can evaluate",
                            );
                        };
                        bytes[start..end].copy_from_slice(&v.to_bytes()[..end - start]);
                    } else {
                        let Some((re, im)) = constexpr::eval_complex(expr, &self.tcx) else {
                            return not_constant();
                        };
                        if matches!(expr.ty, Type::ComplexFloat) {
                            bytes[start..start + 4].copy_from_slice(&(re as f32).to_le_bytes());
                            bytes[start + 4..end].copy_from_slice(&(im as f32).to_le_bytes());
                        } else {
                            bytes[start..start + 8].copy_from_slice(&re.to_le_bytes());
                            bytes[start + 8..end].copy_from_slice(&im.to_le_bytes());
                        }
                    }
                }
                InitItem::Copy { offset, expr, size } => {
                    // A file-scope compound literal is a constant (GNU extension).
                    let source = match &expr.kind {
                        ExprKind::Global(id) => {
                            self.globals.get(*id as usize).filter(|g| g.has_initializer)
                        }
                        _ => None,
                    };
                    let Some(source) = source else {
                        return err(
                            expr.loc,
                            "initializer element is not a compile-time constant",
                        );
                    };
                    let start = *offset as usize;
                    let end = start + *size as usize;
                    if end > bytes.len() {
                        return err(expr.loc, "initializer writes outside the object");
                    }
                    relocs.retain(|r| r.offset + 8 <= *offset || r.offset >= end as u64);
                    bytes[start..end].fill(0);
                    let n = source.init.len().min(*size as usize);
                    bytes[start..start + n].copy_from_slice(&source.init[..n]);
                    for r in &source.relocs {
                        relocs.push(DataReloc {
                            offset: offset + r.offset,
                            target: r.target.clone(),
                            addend: r.addend,
                        });
                    }
                }
                InitItem::Bits {
                    offset,
                    field,
                    expr,
                } => {
                    let Ok(Const::Int(v)) = constexpr::eval(expr, &self.tcx) else {
                        return err(
                            expr.loc,
                            "initializer element is not a compile-time constant",
                        );
                    };
                    // Merge the field into the (up to 9) bytes that hold it.
                    let start = *offset as usize;
                    let nbytes = field.bytes() as usize;
                    if start + nbytes > bytes.len() {
                        return err(expr.loc, "initializer writes outside the object");
                    }
                    let mut unit = [0u8; 16];
                    unit[..nbytes].copy_from_slice(&bytes[start..start + nbytes]);
                    let mask: u128 = (1u128 << field.width) - 1;
                    let merged = (u128::from_le_bytes(unit) & !(mask << field.bit_offset))
                        | ((v as u64 as u128 & mask) << field.bit_offset);
                    bytes[start..start + nbytes].copy_from_slice(&merged.to_le_bytes()[..nbytes]);
                }
            }
        }
        let mut used = bytes.len();
        while used > 0 && bytes[used - 1] == 0 {
            used -= 1;
        }
        bytes.truncate(used);
        Ok((bytes, relocs))
    }
}

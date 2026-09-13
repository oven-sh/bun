//! Typed AST -> BIR.
//!
//! Conventions the B3 lowering can rely on:
//!
//! * C integer types narrower than `int` are held in I32 values that are always
//!   sign/zero-extended according to the C type. They are re-normalised (SExt8/SExt16 or
//!   And with a mask) wherever a wider value is converted to them; `_Bool` conversion is
//!   `Ne v, 0`.
//! * A value is only ever used in the block that defines it. Anything that crosses a
//!   block boundary (C variables, `&&`/`||`/`?:` results, operands evaluated before an
//!   operand that contains control flow) goes through a BIR local.
//! * Scalar C variables whose address is never taken are BIR locals; everything else is
//!   a stack slot. Parameters are copied into their variable on entry.
//! * Struct/union-typed expressions evaluate to the address of the object (I64).
//! * `Br`/`Select` conditions are always exactly 0 or 1.

use std::collections::BTreeMap;
use std::rc::Rc;

use crate::abi::{self, ArgPass, CallAbi, Piece, RetPass};
use crate::ast::*;
use crate::bir::{self, BinOp as CBin, ConvOp, FuncBuilder, Inst, MemKind, Ty, UnOp, V};
use crate::token::{Loc, Res, err};
use crate::types::{BitField, FuncType, Type, TypeCtx};

#[path = "codegen_bytes.rs"]
mod bytes;
#[path = "codegen_x87.rs"]
mod long_double;
#[path = "codegen_pair.rs"]
mod pair;
#[path = "codegen_simd.rs"]
mod simd;
#[path = "codegen_sroa.rs"]
mod sroa;

/// Where a C local variable lives.
#[derive(Clone, Copy)]
enum LocalPlace {
    Reg(u32),
    /// A 128-bit integer whose address is never taken: the BIR locals that hold its low
    /// and high halves. Reading it as an object (`gen_place`) gives a copy in memory;
    /// every construct that writes a variable sets the halves instead.
    Halves(u32, u32),
    /// An array or structure only ever used element by element (see `sroa`): its elements
    /// are the BIR locals in that entry of `FnGen::scalar_sets`.
    Scalars(u32),
    Slot(u32),
    /// An aggregate parameter that arrives as the address of a private copy; the address
    /// is a parameter value, usable in every block.
    Addr(V),
    /// A variable length array: the BIR local that holds the address StackAlloc returned.
    Dynamic(u32),
}

/// An lvalue that has been evaluated.
#[derive(Clone, Copy)]
enum Place {
    Reg(u32),
    Mem {
        base: V,
        offset: i64,
    },
    /// A bit-field inside the bytes starting at `base + offset`.
    Bits {
        base: V,
        offset: i64,
        field: BitField,
    },
    /// One lane of a vector variable that lives in a BIR local.
    Lane {
        local: u32,
        lane: bir::Lane,
        index: u8,
        signed: bool,
    },
}

/// A value kept alive while code that may start new blocks is generated.
#[derive(Clone, Copy)]
enum Held {
    Value(V),
    Temp(u32),
}

/// What a `Call` targets.
#[derive(Clone, Copy)]
enum Callee {
    Func(u32),
    Extern(u32),
    Indirect(V),
}

struct ModuleGen<'a> {
    prog: &'a Program,
    tcx: &'a TypeCtx,
    sigs: Vec<bir::Sig>,
    sig_ids: BTreeMap<bir::Sig, u32>,
    externs: Vec<bir::Extern>,
    /// C function id -> BIR function index (defined) or extern index (declared only).
    func_index: Vec<Option<u32>>,
    extern_index: Vec<Option<u32>>,
    data_extern_index: Vec<Option<u32>>,
    /// Compiler runtime functions (`__divti3`, ...) by name.
    runtime_externs: BTreeMap<String, u32>,
    /// How many local arrays and structures were replaced by their elements.
    replaced_aggregates: usize,
    /// How many byte-by-byte reads and writes of an integer became one access.
    combined_loads: usize,
    combined_stores: usize,
    /// Data externs that stand for thread-local objects other units define.
    tls_externs: Vec<TlsExtern>,
    /// Anonymous read-only data: string literals and initializer images.
    blobs: Vec<Vec<u8>>,
    blob_ids: BTreeMap<Vec<u8>, u32>,
    /// For an object that is only declared here under an assembler name that an object
    /// this unit defines has: that object. Every other object maps to itself.
    same_object: Vec<GlobalId>,
}

/// For every declared-only function whose assembler name is the name of a function this
/// unit defines: that function.
fn same_functions(prog: &Program) -> Vec<Option<FuncId>> {
    let mut defined: BTreeMap<&str, FuncId> = BTreeMap::new();
    for (i, f) in prog.funcs.iter().enumerate() {
        if f.body.is_some() {
            defined.insert(f.link_name.as_deref().unwrap_or(&f.name), i as FuncId);
        }
    }
    prog.funcs
        .iter()
        .map(|f| match (&f.body, &f.link_name) {
            (None, Some(label)) => defined.get(&**label).copied(),
            _ => None,
        })
        .collect()
}

fn same_objects(prog: &Program) -> Vec<GlobalId> {
    let mut defined: BTreeMap<&str, GlobalId> = BTreeMap::new();
    for (i, g) in prog.globals.iter().enumerate() {
        if g.defined && !g.is_static {
            defined.insert(g.link_name.as_deref().unwrap_or(&g.name), i as GlobalId);
        }
    }
    prog.globals
        .iter()
        .enumerate()
        .map(|(i, g)| match (g.defined, &g.link_name) {
            (false, Some(label)) => defined.get(&**label).copied().unwrap_or(i as GlobalId),
            _ => i as GlobalId,
        })
        .collect()
}

impl<'a> ModuleGen<'a> {
    /// How a call with these argument types is made on the target; `named` of them are
    /// declared parameters.
    fn call_abi(&self, ret: &Type, args: &[Type], named: usize, loc: Loc) -> Res<CallAbi> {
        abi::lower_call(self.tcx, ret, args, named).map_err(|msg| crate::token::Error { loc, msg })
    }

    /// The signature of a function of type `fty`, as its definition and plain calls see it.
    fn sig_for(&mut self, fty: &FuncType, loc: Loc) -> Res<u32> {
        let abi = self.call_abi(&fty.ret, &fty.params, fty.params.len(), loc)?;
        Ok(self.intern_sig(bir::Sig {
            rets: abi.rets,
            variadic: fty.variadic,
            params: abi.named_params,
        }))
    }

    fn intern_sig(&mut self, sig: bir::Sig) -> u32 {
        if let Some(&id) = self.sig_ids.get(&sig) {
            return id;
        }
        let id = self.sigs.len() as u32;
        self.sigs.push(sig.clone());
        self.sig_ids.insert(sig, id);
        id
    }

    /// The extern table entry for a function that is declared but not defined here.
    fn extern_for(&mut self, id: FuncId) -> Res<u32> {
        if let Some(index) = self.extern_index[id as usize] {
            return Ok(index);
        }
        let f = &self.prog.funcs[id as usize];
        let fty = Rc::clone(&f.ty);
        let sig = self.sig_for(&fty, f.loc)?;
        let index = self.externs.len() as u32;
        self.externs.push(bir::Extern {
            name: f.link_name.as_ref().unwrap_or(&f.name).to_string(),
            kind: bir::ExternKind::Function,
            weak: f.weak.is_some(),
            sig,
        });
        self.extern_index[id as usize] = Some(index);
        Ok(index)
    }

    /// The extern table entry for a function of the compiler runtime library.
    fn runtime_extern(&mut self, name: &str, ret: &Type, args: &[Type], loc: Loc) -> Res<u32> {
        if let Some(&index) = self.runtime_externs.get(name) {
            return Ok(index);
        }
        let abi = self.call_abi(ret, args, args.len(), loc)?;
        let sig = self.intern_sig(bir::Sig {
            rets: abi.rets,
            variadic: false,
            params: abi.named_params,
        });
        let index = self.externs.len() as u32;
        self.externs.push(bir::Extern {
            name: name.to_string(),
            kind: bir::ExternKind::Function,
            weak: false,
            sig,
        });
        self.runtime_externs.insert(name.to_string(), index);
        Ok(index)
    }

    /// The extern table entry for a variable that is declared `extern` but not defined here.
    fn data_extern_for(&mut self, id: GlobalId) -> u32 {
        if let Some(index) = self.data_extern_index[id as usize] {
            return index;
        }
        let index = self.externs.len() as u32;
        let g = &self.prog.globals[id as usize];
        self.externs.push(bir::Extern {
            name: g.link_name.as_ref().unwrap_or(&g.name).to_string(),
            kind: bir::ExternKind::Data,
            weak: g.weak,
            sig: 0,
        });
        self.data_extern_index[id as usize] = Some(index);
        index
    }

    fn blob(&mut self, bytes: Vec<u8>) -> u32 {
        if let Some(&id) = self.blob_ids.get(&bytes) {
            return id;
        }
        let id = self.blobs.len() as u32;
        self.blobs.push(bytes.clone());
        self.blob_ids.insert(bytes, id);
        id
    }

    fn string_blob(&mut self, id: StrId) -> u32 {
        self.blob(self.prog.strings[id as usize].to_vec())
    }

    /// Provisional `DataAddr` operand for a data object; patched once the segment is laid out.
    fn global_object(&self, id: GlobalId) -> u64 {
        u64::from(id)
    }

    fn blob_object(&self, blob: u32) -> u64 {
        self.prog.globals.len() as u64 + u64::from(blob)
    }
}

struct FnGen<'a, 'm> {
    m: &'m mut ModuleGen<'a>,
    tcx: &'a TypeCtx,
    b: FuncBuilder,
    locals: Vec<LocalPlace>,
    scalar_sets: Vec<Vec<sroa::Leaf>>,
    local_types: &'a [LocalVar],
    labels: Vec<Option<u32>>,
    /// Target block and how many `VlaScope`s were open when the loop or switch began.
    break_stack: Vec<(u32, usize)>,
    continue_stack: Vec<(u32, usize)>,
    /// The open `VlaScope`s: id, the local that holds the saved stack pointer (for one that
    /// releases variable length arrays) and the cleanup call (for one that has it).
    vla_stack: Vec<(u32, Option<u32>, Option<Expr>)>,
    body: &'a FuncBody,
    free_temps: [Vec<u32>; 5],
    ret: Type,
    ret_pass: RetPass,
    /// `gen_wide` is about to make a call and wants the halves of its 128-bit result as
    /// values; `emit_call` leaves them in `wide_result` instead of storing them.
    want_wide_result: bool,
    wide_result: Option<(V, V)>,
    /// The halves of the 128-bit arguments of the call about to be emitted, by position,
    /// for those that were computed as values.
    wide_arguments: Vec<Option<(V, V)>>,
    /// The expression about to be generated is a statement: nobody uses its value.
    /// (`gen_expr` takes this, so it only ever describes the outermost expression.)
    result_unused: bool,
}

/// The integer type a bit-field is worked on in once it is loaded.
fn bit_field_type(field: BitField) -> Type {
    if field.bit_offset + field.width <= 32 {
        Type::UInt
    } else {
        Type::ULLong
    }
}

/// AAPCS64 register save area stride: 16 bytes per vector register, 8 per general one.
fn stride_of(float: bool) -> i32 {
    if float { 16 } else { 8 }
}

fn ty_slot(ty: Ty) -> usize {
    match ty {
        Ty::I32 | Ty::Void => 0,
        Ty::I64 => 1,
        Ty::F32 => 2,
        Ty::F64 => 3,
        Ty::V128 => 4,
    }
}

fn internal<T>(loc: Loc, what: &str) -> Res<T> {
    err(loc, format!("internal compiler error: {what}"))
}

impl<'a> FnGen<'a, '_> {
    // ───────────────────────────── small helpers ─────────────────────────────

    fn mty(&self, ty: &Type) -> Ty {
        self.tcx.machine_ty(ty)
    }

    fn alloc_temp(&mut self, ty: Ty) -> u32 {
        match self.free_temps[ty_slot(ty)].pop() {
            Some(t) => t,
            None => self.b.add_local(ty),
        }
    }

    fn free_temp(&mut self, temp: u32, ty: Ty) {
        self.free_temps[ty_slot(ty)].push(temp);
    }

    /// Keeps `v` usable after generating code that may switch blocks.
    fn hold(&mut self, v: V, later_has_control_flow: bool) -> Held {
        if !later_has_control_flow {
            return Held::Value(v);
        }
        let ty = self.b.value_ty(v);
        let temp = self.alloc_temp(ty);
        self.b.effect(Inst::LocalSet(temp, v));
        Held::Temp(temp)
    }

    fn release(&mut self, held: Held) -> V {
        match held {
            Held::Value(v) => v,
            Held::Temp(temp) => {
                let v = self.b.local_get(temp);
                let ty = self.b.value_ty(v);
                self.free_temp(temp, ty);
                v
            }
        }
    }

    fn zero(&mut self, ty: Ty) -> V {
        match ty {
            Ty::F32 => self.b.def(Inst::ConstF32(0), Ty::F32),
            Ty::F64 => self.b.def(Inst::ConstF64(0), Ty::F64),
            Ty::V128 => self.const_v128([0; 16]),
            other => self.b.const_int(other, 0),
        }
    }

    /// Re-establishes the "narrow ints are kept extended" invariant for a value of C type `ty`.
    fn normalize(&mut self, v: V, ty: &Type) -> V {
        match ty.unatomic() {
            Type::Bool => {
                let zero = self.b.const_i32(0);
                self.b.bin(CBin::Ne, v, zero)
            }
            Type::SChar => self.b.un(UnOp::SExt8, v),
            Type::Char if self.tcx.is_signed(ty) => self.b.un(UnOp::SExt8, v),
            Type::Char | Type::UChar => {
                let mask = self.b.const_i32(0xff);
                self.b.bin(CBin::And, v, mask)
            }
            Type::Short => self.b.un(UnOp::SExt16, v),
            Type::UShort => {
                let mask = self.b.const_i32(0xffff);
                self.b.bin(CBin::And, v, mask)
            }
            _ => v,
        }
    }

    /// Whether every value of integer type `from` is representable unchanged in narrow type `to`.
    fn fits_without_normalizing(&self, from: &Type, to: &Type) -> bool {
        if !from.is_integer() || !self.tcx.is_narrow(from) {
            return false;
        }
        if from == to || matches!(from, Type::Bool) {
            return true;
        }
        let (fs, ts) = (
            self.tcx.size_of(from).unwrap_or(8),
            self.tcx.size_of(to).unwrap_or(0),
        );
        let (fsigned, tsigned) = (self.tcx.is_signed(from), self.tcx.is_signed(to));
        !matches!(to, Type::Bool)
            && ((fsigned == tsigned && fs <= ts) || (!fsigned && tsigned && fs < ts))
    }

    /// Converts scalar `v` from C type `from` to C type `to`.
    fn convert(&mut self, v: V, from: &Type, to: &Type, loc: Loc) -> Res<V> {
        let (from, to) = (from.unatomic(), to.unatomic());
        // Vectors only convert by reinterpretation.
        if from == to || (from.is_vector() && to.is_vector()) {
            return Ok(v);
        }
        // An 8-byte vector and a 64-bit integer are the same bits (`vcreate_u8`, `_mm_cvtsi64_m64`).
        if self.tcx.is_half_vector(from) || self.tcx.is_half_vector(to) {
            let (have, want) = (self.b.value_ty(v), self.mty(to));
            return Ok(match (have, want) {
                (Ty::I64, Ty::F64) | (Ty::F64, Ty::I64) => self.b.conv(ConvOp::Bitcast, want, v),
                (have, want) if have == want => v,
                _ => return internal(loc, "an 8-byte vector converted to a type of another size"),
            });
        }
        if from.is_long_double() || to.is_long_double() {
            return self.long_double_convert(v, from, to, loc);
        }
        if from.is_pair() || to.is_pair() {
            return self.gen_pair_convert(v, from, to, loc);
        }
        let (fm, tm) = (self.mty(from), self.mty(to));
        if matches!(to, Type::Bool) {
            if matches!(from, Type::Bool) {
                return Ok(v);
            }
            let zero = self.zero(fm);
            return Ok(self.b.bin(CBin::Ne, v, zero));
        }
        let from_signed = self.tcx.is_signed(from);
        let to_signed = self.tcx.is_signed(to);
        Ok(match (fm, tm) {
            (Ty::I32 | Ty::I64, Ty::I32 | Ty::I64) => {
                let narrowed = match (fm, tm) {
                    (Ty::I64, Ty::I32) => self.b.un(UnOp::Trunc, v),
                    (Ty::I32, Ty::I64) => self.b.un(
                        if from_signed {
                            UnOp::SExt32
                        } else {
                            UnOp::ZExt32
                        },
                        v,
                    ),
                    _ => v,
                };
                if self.tcx.is_narrow(to) && !self.fits_without_normalizing(from, to) {
                    self.normalize(narrowed, to)
                } else {
                    narrowed
                }
            }
            (Ty::I32 | Ty::I64, Ty::F32 | Ty::F64) => {
                // Narrow unsigned values are non-negative I32s, so the signed conversion is exact.
                let unsigned = !from_signed && !self.tcx.is_narrow(from);
                self.b
                    .conv(if unsigned { ConvOp::UToF } else { ConvOp::SToF }, tm, v)
            }
            (Ty::F32 | Ty::F64, Ty::I32 | Ty::I64) => {
                let narrow = self.tcx.is_narrow(to);
                let op = if to_signed || narrow {
                    ConvOp::FToS
                } else {
                    ConvOp::FToU
                };
                let converted = self.b.conv(op, tm, v);
                if narrow {
                    self.normalize(converted, to)
                } else {
                    converted
                }
            }
            (Ty::F32, Ty::F64) => self.b.un(UnOp::FPromote, v),
            (Ty::F64, Ty::F32) => self.b.un(UnOp::FDemote, v),
            (Ty::F32, Ty::F32) | (Ty::F64, Ty::F64) => v,
            _ => return internal(loc, "conversion involving void"),
        })
    }

    // ───────────────────────────── places ─────────────────────────────

    fn data_addr(&mut self, object: u64) -> V {
        self.b.def(Inst::DataAddr(object), Ty::I64)
    }

    fn gen_place(&mut self, e: &Expr) -> Res<Place> {
        if let Some(reg) = self.leaf_of(e) {
            return Ok(Place::Reg(reg));
        }
        match &e.kind {
            ExprKind::Local(id) => Ok(match self.locals[*id as usize] {
                LocalPlace::Reg(local) => Place::Reg(local),
                LocalPlace::Halves(low, high) => {
                    let (low, high) = (self.b.local_get(low), self.b.local_get(high));
                    Place::Mem {
                        base: self.make_pair(&e.ty, low, high),
                        offset: 0,
                    }
                }
                LocalPlace::Scalars(_) => {
                    return internal(e.loc, "a replaced aggregate used as an object");
                }
                LocalPlace::Slot(slot) => Place::Mem {
                    base: self.b.def(Inst::SlotAddr(slot), Ty::I64),
                    offset: 0,
                },
                LocalPlace::Addr(base) => Place::Mem { base, offset: 0 },
                LocalPlace::Dynamic(reg) => Place::Mem {
                    base: self.b.local_get(reg),
                    offset: 0,
                },
            }),
            ExprKind::Global(id) => {
                let id = &self.m.same_object[*id as usize];
                let global = &self.m.prog.globals[*id as usize];
                let base = if global.thread_local && global.defined {
                    // Patched to the offset in the tls segment once that is laid out.
                    self.b.def(Inst::TlsAddr(u64::from(*id)), Ty::I64)
                } else if global.thread_local {
                    // Defined in another translation unit, if anywhere: the linker decides.
                    let index = self.m.data_extern_for(*id);
                    if !self.m.tls_externs.iter().any(|t| t.index == index) {
                        self.m.tls_externs.push(TlsExtern {
                            index,
                            name: global.name.to_string(),
                            loc: e.loc,
                        });
                    }
                    self.b.def(Inst::ExternAddr(index), Ty::I64)
                } else if global.defined {
                    let object = self.m.global_object(*id);
                    self.data_addr(object)
                } else {
                    let index = self.m.data_extern_for(*id);
                    self.b.def(Inst::ExternAddr(index), Ty::I64)
                };
                Ok(Place::Mem { base, offset: 0 })
            }
            ExprKind::StrLit(id) => {
                let blob = self.m.string_blob(*id);
                let object = self.m.blob_object(blob);
                Ok(Place::Mem {
                    base: self.data_addr(object),
                    offset: 0,
                })
            }
            ExprKind::Deref(ptr) => {
                // `p[3]` / `*(p + 3)`: fold the constant displacement into the access.
                if let ExprKind::PtrAdd {
                    ptr: base,
                    index,
                    scale,
                    sub,
                } = &ptr.kind
                {
                    if let ExprKind::IntLit(i) = index.kind {
                        let delta = i.wrapping_mul(*scale as i64);
                        let delta = if *sub { delta.wrapping_neg() } else { delta };
                        let base = self.gen_value(base)?;
                        return Ok(Place::Mem {
                            base,
                            offset: delta,
                        });
                    }
                }
                Ok(Place::Mem {
                    base: self.gen_value(ptr)?,
                    offset: 0,
                })
            }
            ExprKind::CompoundLiteral {
                local,
                zero_first,
                items,
            } => {
                self.gen_local_init(*local, *zero_first, items, e.loc)?;
                match self.locals[*local as usize] {
                    LocalPlace::Reg(reg) => Ok(Place::Reg(reg)),
                    LocalPlace::Halves(..) | LocalPlace::Scalars(_) => {
                        internal(e.loc, "a compound literal is an object in memory")
                    }
                    LocalPlace::Slot(slot) => Ok(Place::Mem {
                        base: self.b.def(Inst::SlotAddr(slot), Ty::I64),
                        offset: 0,
                    }),
                    LocalPlace::Addr(base) => Ok(Place::Mem { base, offset: 0 }),
                    LocalPlace::Dynamic(reg) => Ok(Place::Mem {
                        base: self.b.local_get(reg),
                        offset: 0,
                    }),
                }
            }
            ExprKind::Member(base, member_offset) => {
                let place = if base.is_lvalue() {
                    self.gen_place(base)?
                } else {
                    Place::Mem {
                        base: self.gen_value(base)?,
                        offset: 0,
                    }
                };
                match place {
                    Place::Mem { base, offset } => Ok(Place::Mem {
                        base,
                        offset: offset.wrapping_add(*member_offset as i64),
                    }),
                    _ => internal(e.loc, "member access on a non-memory object"),
                }
            }
            ExprKind::BitField {
                base,
                offset: member_offset,
                field,
            } => {
                let place = if base.is_lvalue() {
                    self.gen_place(base)?
                } else {
                    Place::Mem {
                        base: self.gen_value(base)?,
                        offset: 0,
                    }
                };
                match place {
                    Place::Mem { base, offset } => Ok(Place::Bits {
                        base,
                        offset: offset.wrapping_add(*member_offset as i64),
                        field: *field,
                    }),
                    _ => internal(e.loc, "bit-field access on a non-memory object"),
                }
            }
            ExprKind::VecElem(base, index) => self.gen_lane_place(e, base, index),
            ExprKind::ComplexPart(base, imag) => {
                let part = FnGen::complex_part_offset(&base.ty, *imag);
                match self.gen_place(base)? {
                    Place::Mem { base, offset } => Ok(Place::Mem {
                        base,
                        offset: offset + part,
                    }),
                    _ => internal(e.loc, "part of a complex number that is not in memory"),
                }
            }
            _ => internal(e.loc, "expression is not an lvalue"),
        }
    }

    fn place_addr(&mut self, place: Place, loc: Loc) -> Res<V> {
        match place {
            Place::Reg(_) => internal(loc, "address of a register variable"),
            Place::Bits { .. } => internal(loc, "address of a bit-field"),
            Place::Lane { .. } => internal(loc, "address of a lane of a register variable"),
            Place::Mem { base, offset: 0 } => Ok(base),
            Place::Mem { base, offset } => {
                let delta = self.b.const_i64(offset);
                Ok(self.b.bin(CBin::Add, base, delta))
            }
        }
    }

    fn load_place(&mut self, place: Place, ty: &Type, loc: Loc) -> Res<V> {
        let volatile = ty.is_volatile();
        let ty = ty.unatomic();
        if !ty.is_value() {
            return self.place_addr(place, loc);
        }
        Ok(match place {
            Place::Reg(local) => self.b.local_get(local),
            Place::Lane {
                local,
                lane,
                index,
                signed,
            } => {
                let vector = self.b.local_get(local);
                let vector = self.whole_vector(vector);
                self.b.def(
                    Inst::VExtract(lane, signed, index, vector),
                    lane.scalar_ty(),
                )
            }
            Place::Mem { base, offset } => {
                self.load_memory(self.tcx.mem_kind(ty, false), base, offset, volatile)
            }
            Place::Bits {
                base,
                offset,
                field,
            } => {
                let unit_ty = bit_field_type(field);
                let signed = self.tcx.is_signed(ty);
                let value = if field.bytes() > 8 {
                    // A packed field that starts mid-byte and runs into a ninth one.
                    let (low, high) = self.load_wide_bits(base, offset, volatile);
                    let down = self.b.const_i32(field.bit_offset as i32);
                    let low = self.b.bin(CBin::ShrU, low, down);
                    let up = self.b.const_i32((64 - field.bit_offset) as i32);
                    let high = self.b.bin(CBin::Shl, high, up);
                    let joined = self.b.bin(CBin::Or, low, high);
                    self.extract_bits(joined, 0, field, signed)
                } else {
                    let unit = self.load_bit_field_unit(base, offset, field, volatile);
                    self.extract_bits(unit, field.bit_offset, field, signed)
                };
                self.convert(value, &unit_ty, ty, loc)?
            }
        })
    }

    /// The bytes that hold `field` (at most 8), as an I32 or I64 as `bit_field_type` says.
    fn load_bit_field_unit(&mut self, base: V, offset: i64, field: BitField, volatile: bool) -> V {
        let exact = field.bytes();
        let bytes = if exact.is_power_of_two() {
            exact
        } else {
            u64::from(field.readable)
        };
        let raw = if bytes == 0 {
            self.load_bytes(base, offset, exact, volatile)
        } else {
            self.load_bytes(base, offset, bytes, volatile)
        };
        // One load can bring in more than the field needs.
        let wide = bit_field_type(field) == Type::ULLong;
        match (self.b.value_ty(raw) == Ty::I64, wide) {
            (true, false) => self.b.un(UnOp::Trunc, raw),
            (false, true) => self.b.un(UnOp::ZExt32, raw),
            _ => raw,
        }
    }

    /// The eight bytes at `offset` and the ninth, both as I64.
    fn load_wide_bits(&mut self, base: V, offset: i64, volatile: bool) -> (V, V) {
        let low = self.load_memory(MemKind::I64, base, offset, volatile);
        let high = self.load_memory(MemKind::I8U, base, offset + 8, volatile);
        (low, self.b.un(UnOp::ZExt32, high))
    }

    fn load_memory(&mut self, kind: MemKind, base: V, offset: i64, volatile: bool) -> V {
        if volatile {
            return self
                .b
                .def(Inst::VolatileLoad(kind, base, offset), kind.value_ty());
        }
        self.b.load(kind, base, offset)
    }

    fn store_memory(&mut self, kind: MemKind, v: V, base: V, offset: i64, volatile: bool) {
        self.b.effect(if volatile {
            Inst::VolatileStore(kind, v, base, offset)
        } else {
            Inst::Store(kind, v, base, offset)
        });
    }

    /// Pulls a bit-field that starts `bit_offset` bits into `unit` out of it, sign- or
    /// zero-extending it to the width of `unit`.
    fn extract_bits(&mut self, unit: V, bit_offset: u32, field: BitField, signed: bool) -> V {
        let bits: u32 = if self.b.value_ty(unit) == Ty::I64 {
            64
        } else {
            32
        };
        if signed {
            let up = self.b.const_i32((bits - bit_offset - field.width) as i32);
            let high = self.b.bin(CBin::Shl, unit, up);
            let down = self.b.const_i32((bits - field.width) as i32);
            return self.b.bin(CBin::ShrS, high, down);
        }
        let shifted = if bit_offset == 0 {
            unit
        } else {
            let down = self.b.const_i32(bit_offset as i32);
            self.b.bin(CBin::ShrU, unit, down)
        };
        if field.width >= bits {
            return shifted;
        }
        let mask = self
            .b
            .const_int(self.b.value_ty(unit), ((1u64 << field.width) - 1) as i64);
        self.b.bin(CBin::And, shifted, mask)
    }

    /// Stores `v` (of C type `ty`) and returns the value the object now holds.
    fn store_place(&mut self, place: Place, ty: &Type, v: V, loc: Loc) -> Res<V> {
        let volatile = ty.is_volatile();
        let ty = ty.unatomic();
        if ty.is_pair() || ty.is_long_double() {
            // `v` is the address of the new value.
            let address = self.place_addr(place, loc)?;
            let n = self.b.const_i64(self.tcx.size_of(ty).unwrap_or(0) as i64);
            self.b.effect(Inst::MemCopy(address, v, n));
            return Ok(v);
        }
        match place {
            Place::Reg(local) => self.b.effect(Inst::LocalSet(local, v)),
            Place::Lane {
                local, lane, index, ..
            } => {
                let held = self.b.local_get(local);
                let carrier = self.b.value_ty(held);
                let vector = self.whole_vector(held);
                let updated = self.b.def(Inst::VReplace(lane, index, vector, v), Ty::V128);
                let updated = self.low_half_as(updated, carrier);
                self.b.effect(Inst::LocalSet(local, updated));
            }
            Place::Mem { base, offset } => {
                self.store_memory(self.tcx.mem_kind(ty, true), v, base, offset, volatile);
            }
            Place::Bits {
                base,
                offset,
                field,
            } => {
                let unit_ty = bit_field_type(field);
                let unit_mty = self.mty(&unit_ty);
                let new = self.convert(v, ty, &unit_ty, loc)?;
                let mask: u64 = if field.width >= 64 {
                    u64::MAX
                } else {
                    (1u64 << field.width) - 1
                };
                if field.bytes() > 8 {
                    let (low, high) = self.load_wide_bits(base, offset, volatile);
                    let shift = field.bit_offset;
                    let keep_low = self.b.const_i64(!(mask << shift) as i64);
                    let kept_low = self.b.bin(CBin::And, low, keep_low);
                    let keep_high = self.b.const_i64(!(mask >> (64 - shift)) as i64);
                    let kept_high = self.b.bin(CBin::And, high, keep_high);
                    let field_mask = self.b.const_i64(mask as i64);
                    let bits = self.b.bin(CBin::And, new, field_mask);
                    let up = self.b.const_i32(shift as i32);
                    let placed_low = self.b.bin(CBin::Shl, bits, up);
                    let down = self.b.const_i32((64 - shift) as i32);
                    let placed_high = self.b.bin(CBin::ShrU, bits, down);
                    let new_low = self.b.bin(CBin::Or, kept_low, placed_low);
                    let new_high = self.b.bin(CBin::Or, kept_high, placed_high);
                    self.store_memory(MemKind::I64, new_low, base, offset, volatile);
                    let new_high = self.b.un(UnOp::Trunc, new_high);
                    self.store_memory(MemKind::I8U, new_high, base, offset + 8, volatile);
                } else {
                    let old = self.load_bit_field_unit(base, offset, field, volatile);
                    let keep = self
                        .b
                        .const_int(unit_mty, !(mask << field.bit_offset) as i64);
                    let kept = self.b.bin(CBin::And, old, keep);
                    let field_mask = self.b.const_int(unit_mty, mask as i64);
                    let low = self.b.bin(CBin::And, new, field_mask);
                    let placed = if field.bit_offset == 0 {
                        low
                    } else {
                        let up = self.b.const_i32(field.bit_offset as i32);
                        self.b.bin(CBin::Shl, low, up)
                    };
                    let merged = self.b.bin(CBin::Or, kept, placed);
                    // Only the bytes that hold the field are written: what follows them may
                    // be another object.
                    self.store_bytes(merged, base, offset, field.bytes(), volatile);
                }
                let stored = self.extract_bits(new, 0, field, self.tcx.is_signed(ty));
                return self.convert(stored, &unit_ty, ty, loc);
            }
        }
        Ok(v)
    }

    fn hold_place(&mut self, place: Place, later_has_control_flow: bool) -> (Option<Held>, Place) {
        match place {
            Place::Mem { base, .. } | Place::Bits { base, .. } if later_has_control_flow => {
                (Some(self.hold(base, true)), place)
            }
            _ => (None, place),
        }
    }

    fn release_place(&mut self, held: Option<Held>, place: Place) -> Place {
        match (held, place) {
            (Some(h), Place::Mem { offset, .. }) => Place::Mem {
                base: self.release(h),
                offset,
            },
            (Some(h), Place::Bits { offset, field, .. }) => Place::Bits {
                base: self.release(h),
                offset,
                field,
            },
            (_, place) => place,
        }
    }

    // ───────────────────────────── expressions ─────────────────────────────

    fn gen_value(&mut self, e: &Expr) -> Res<V> {
        match self.gen_expr(e)? {
            Some(v) => Ok(v),
            None => internal(e.loc, "void expression used as a value"),
        }
    }

    fn gen_discard(&mut self, e: &Expr) -> Res<()> {
        self.result_unused = true;
        self.gen_expr(e)?;
        Ok(())
    }

    /// Whether a store of `ty` to `place` keeps only the low bits of what it is given, so
    /// that the value need not be brought into `ty`'s range first.
    fn store_truncates(&self, place: Place, ty: &Type) -> bool {
        let ty = ty.unatomic();
        matches!(place, Place::Mem { .. })
            && self.tcx.is_narrow(ty)
            && ty.is_integer()
            && !matches!(ty, Type::Bool)
    }

    /// `v`, an integer of any width, as the I32 a narrow store takes.
    fn low_word(&mut self, v: V) -> V {
        if self.b.value_ty(v) == Ty::I64 {
            self.b.un(UnOp::Trunc, v)
        } else {
            v
        }
    }

    fn arith_op(&self, op: BinOp, operand_ty: &Type) -> CBin {
        let float = operand_ty.is_float();
        let signed = float || self.tcx.is_signed(operand_ty);
        match op {
            BinOp::Add => CBin::Add,
            BinOp::Sub => CBin::Sub,
            BinOp::Mul => CBin::Mul,
            BinOp::Div => {
                if signed {
                    CBin::Div
                } else {
                    CBin::UDiv
                }
            }
            BinOp::Rem => {
                if signed {
                    CBin::Rem
                } else {
                    CBin::URem
                }
            }
            BinOp::And => CBin::And,
            BinOp::Or => CBin::Or,
            BinOp::Xor => CBin::Xor,
            BinOp::Shl => CBin::Shl,
            BinOp::Shr => {
                if signed {
                    CBin::ShrS
                } else {
                    CBin::ShrU
                }
            }
            BinOp::Eq => CBin::Eq,
            BinOp::Ne => CBin::Ne,
            BinOp::Lt => {
                if signed {
                    CBin::Lt
                } else {
                    CBin::ULt
                }
            }
            BinOp::Le => {
                if signed {
                    CBin::Le
                } else {
                    CBin::ULe
                }
            }
            BinOp::Gt => {
                if signed {
                    CBin::Gt
                } else {
                    CBin::UGt
                }
            }
            BinOp::Ge => {
                if signed {
                    CBin::Ge
                } else {
                    CBin::UGe
                }
            }
        }
    }

    /// `ptr ± index * scale` where `index` is an I64 value.
    fn emit_ptr_add(&mut self, ptr: V, index: V, scale: u64, sub: bool) -> V {
        let scaled = if scale == 1 {
            index
        } else {
            let s = self.b.const_i64(scale as i64);
            self.b.bin(CBin::Mul, index, s)
        };
        self.b
            .bin(if sub { CBin::Sub } else { CBin::Add }, ptr, scaled)
    }

    /// Whether the expression's value is already exactly 0 or 1.
    fn is_boolean(e: &Expr) -> bool {
        match &e.kind {
            ExprKind::Binary(op, ..) => op.is_compare(),
            ExprKind::LogNot(_) | ExprKind::LogAnd(..) | ExprKind::LogOr(..) => true,
            ExprKind::IntLit(v) => *v == 0 || *v == 1,
            _ => matches!(e.ty, Type::Bool),
        }
    }

    /// Evaluates scalar `e` to an I32 that is exactly 0 or 1.
    fn gen_truth(&mut self, e: &Expr) -> Res<V> {
        let v = self.gen_value(e)?;
        if e.ty.is_pair() {
            return Ok(self.pair_truth(v, &e.ty));
        }
        if Self::is_boolean(e) && self.b.value_ty(v) == Ty::I32 {
            return Ok(v);
        }
        let zero = self.zero(self.b.value_ty(v));
        Ok(self.b.bin(CBin::Ne, v, zero))
    }

    /// Evaluates scalar `e` to an I32 that is non-zero exactly if `e` is: what `Br` and
    /// `Select` test. An I32 is that already; other values are compared with zero.
    fn gen_condition(&mut self, e: &Expr) -> Res<V> {
        let v = self.gen_value(e)?;
        if e.ty.is_pair() {
            return Ok(self.pair_truth(v, &e.ty));
        }
        if self.b.value_ty(v) == Ty::I32 {
            return Ok(v);
        }
        let zero = self.zero(self.b.value_ty(v));
        Ok(self.b.bin(CBin::Ne, v, zero))
    }

    /// Branches to `then_block` if scalar `e` is non-zero, else to `else_block`.
    fn gen_cond(&mut self, e: &Expr, then_block: u32, else_block: u32) -> Res<()> {
        match &e.kind {
            ExprKind::LogAnd(a, b) => {
                let mid = self.b.new_block();
                self.gen_cond(a, mid, else_block)?;
                self.b.switch_to(mid);
                self.gen_cond(b, then_block, else_block)
            }
            ExprKind::LogOr(a, b) => {
                let mid = self.b.new_block();
                self.gen_cond(a, then_block, mid)?;
                self.b.switch_to(mid);
                self.gen_cond(b, then_block, else_block)
            }
            ExprKind::LogNot(a) => self.gen_cond(a, else_block, then_block),
            ExprKind::IntLit(v) => {
                self.b
                    .terminate(Inst::Jump(if *v != 0 { then_block } else { else_block }));
                Ok(())
            }
            _ => {
                let v = self.gen_condition(e)?;
                self.b.terminate(Inst::Br(v, then_block, else_block));
                Ok(())
            }
        }
    }

    /// An expression cheap and safe enough to evaluate unconditionally for `Select`.
    fn is_trivial(&self, e: &Expr) -> bool {
        match &e.kind {
            ExprKind::IntLit(_) | ExprKind::FloatLit(_) => true,
            ExprKind::Local(id) => matches!(self.locals[*id as usize], LocalPlace::Reg(_)),
            ExprKind::Cast(inner) => {
                e.ty.is_value() && inner.ty.is_value() && self.is_trivial(inner)
            }
            _ => false,
        }
    }

    fn callee_of(&mut self, callee: &Expr) -> Res<(Callee, Rc<FuncType>)> {
        let Some(Type::Func(fty)) = callee.ty.pointee() else {
            return internal(callee.loc, "callee is not a function pointer");
        };
        let fty = Rc::clone(fty);
        if let ExprKind::Decay(inner) = &callee.kind {
            if let ExprKind::Func(id) = inner.kind {
                // Use the callee's own (possibly more complete) type.
                let fty = Rc::clone(&self.m.prog.funcs[id as usize].ty);
                return Ok(match self.m.func_index[id as usize] {
                    Some(index) => (Callee::Func(index), fty),
                    None => (Callee::Extern(self.m.extern_for(id)?), fty),
                });
            }
        }
        Ok((Callee::Indirect(self.gen_value(callee)?), fty))
    }

    /// Where lvalue `e` sits inside an object with static storage: the object and the byte
    /// offset, if every step of the way there is a constant and nothing on it may change
    /// (each object and subobject named is `const` and not `volatile`). A string literal
    /// counts as unchanging.
    fn constant_path(&self, e: &Expr) -> Option<(RelocTarget, u64)> {
        fn unchanging(ty: &Type) -> bool {
            match ty {
                Type::Array(elem, _) => unchanging(elem),
                other => other.is_const() && !other.is_volatile() && !other.is_atomic(),
            }
        }
        let (root, offset) = match &e.kind {
            ExprKind::StrLit(id) => return Some((RelocTarget::Str(*id), 0)),
            ExprKind::Global(id) => (RelocTarget::Global(self.m.same_object[*id as usize]), 0),
            ExprKind::Member(base, offset) if base.is_lvalue() => {
                let (root, at) = self.constant_path(base)?;
                (root, at.checked_add(*offset)?)
            }
            ExprKind::Deref(address) => {
                // `array[constant]` and `*array`.
                let (array, index) = match &address.kind {
                    ExprKind::PtrAdd {
                        ptr,
                        index,
                        scale,
                        sub: false,
                    } => {
                        let Ok(crate::constexpr::Const::Int(i)) =
                            crate::constexpr::eval(index, self.tcx)
                        else {
                            return None;
                        };
                        (ptr, u64::try_from(i).ok()?.checked_mul(*scale)?)
                    }
                    _ => (address, 0),
                };
                let ExprKind::Decay(array) = &array.kind else {
                    // `*pointer` / `pointer[constant]` for a constant pointer whose value
                    // is an address in a constant object.
                    let mut pointer = array;
                    while let ExprKind::Cast(inner) = &pointer.kind {
                        if inner.ty.unqualified() != pointer.ty.unqualified() {
                            break;
                        }
                        pointer = inner;
                    }
                    if !pointer.is_lvalue() || !pointer.ty.is_ptr() {
                        return None;
                    }
                    let (holder, at) = self.constant_path(pointer)?;
                    let RelocTarget::Global(holder) = holder else {
                        return None;
                    };
                    let g = &self.m.prog.globals[holder as usize];
                    if !g.defined || !g.has_initializer || g.weak || g.thread_local {
                        return None;
                    }
                    let reloc = g.relocs.iter().find(|r| r.offset == at)?;
                    let RelocTarget::Global(target) = reloc.target else {
                        return None;
                    };
                    let target = self.m.same_object[target as usize];
                    let object = &self.m.prog.globals[target as usize];
                    let start = u64::try_from(reloc.addend).ok()?.checked_add(index)?;
                    let inside = start.checked_add(self.tcx.size_of(&e.ty)?)?
                        <= self.tcx.size_of(&object.ty)?;
                    return (inside && unchanging(&object.ty) && unchanging(&e.ty))
                        .then_some((RelocTarget::Global(target), start));
                };
                let (root, at) = self.constant_path(array)?;
                // Inside the array it indexes.
                let size = self.tcx.size_of(&array.ty)?;
                let element = self.tcx.size_of(&e.ty)?;
                if index.checked_add(element)? > size {
                    return None;
                }
                (root, at.checked_add(index)?)
            }
            _ => return None,
        };
        let is_literal = matches!(root, RelocTarget::Str(_));
        (is_literal || unchanging(&e.ty)).then_some((root, offset))
    }

    /// The value of reading scalar lvalue `e`, when that is known now: `e` is a constant
    /// place (see `constant_path`) in an object this unit defines with an initializer.
    fn fold_constant_load(&mut self, e: &Expr) -> Res<Option<V>> {
        let ty = e.ty.unatomic().clone();
        let plain = (ty.is_integer() && !ty.is_int128()) || ty.is_float() || ty.is_ptr();
        if !plain || e.ty.is_volatile() || e.ty.is_atomic() {
            return Ok(None);
        }
        let Some(size) = self.tcx.size_of(&ty) else {
            return Ok(None);
        };
        let Some((root, offset)) = self.constant_path(e) else {
            return Ok(None);
        };
        let prog = self.m.prog;
        let (bytes, relocs, object_size): (&[u8], &[DataReloc], u64) = match &root {
            RelocTarget::Global(id) => {
                let g = &prog.globals[*id as usize];
                // Only a definition with an initializer says what the value is; a weak
                // one may be replaced, a tentative one completed elsewhere.
                if !g.defined || !g.has_initializer || g.weak || g.thread_local {
                    return Ok(None);
                }
                (
                    &g.init,
                    &g.relocs,
                    self.tcx.size_of(&g.ty).unwrap_or(0) + g.extra_size,
                )
            }
            RelocTarget::Str(id) => {
                let text = &prog.strings[*id as usize];
                (text, &[], text.len() as u64)
            }
            RelocTarget::Func(_) => return Ok(None),
        };
        if offset.checked_add(size).is_none_or(|end| end > object_size) {
            return Ok(None);
        }
        // An address stored there: the whole pointer or nothing.
        let overlapping = relocs
            .iter()
            .find(|r| r.offset < offset + size && r.offset + 8 > offset);
        if let Some(reloc) = overlapping {
            if !ty.is_ptr() || reloc.offset != offset || size != 8 {
                return Ok(None);
            }
            let (target, addend) = (reloc.target.clone(), reloc.addend);
            let place_of = |kind: ExprKind, ty: Type| Expr {
                kind,
                ty,
                loc: e.loc,
                has_control_flow: false,
                depth: 1,
            };
            let base = match target {
                RelocTarget::Func(id) => self.func_addr(id)?,
                RelocTarget::Global(id) => {
                    let object =
                        place_of(ExprKind::Global(id), prog.globals[id as usize].ty.clone());
                    let place = self.gen_place(&object)?;
                    self.place_addr(place, e.loc)?
                }
                RelocTarget::Str(id) => {
                    let object = place_of(ExprKind::StrLit(id), Type::Char);
                    let place = self.gen_place(&object)?;
                    self.place_addr(place, e.loc)?
                }
            };
            if addend == 0 {
                return Ok(Some(base));
            }
            let addend = self.b.const_i64(addend);
            return Ok(Some(self.b.bin(CBin::Add, base, addend)));
        }
        // Bytes past the stored initializer are zero.
        let mut raw = [0u8; 8];
        for (k, slot) in raw.iter_mut().enumerate().take(size as usize) {
            *slot = bytes.get(offset as usize + k).copied().unwrap_or(0);
        }
        let bits = u64::from_le_bytes(raw);
        Ok(Some(match &ty {
            Type::Float => self.b.def(Inst::ConstF32(bits as u32), Ty::F32),
            Type::Double => self.b.def(Inst::ConstF64(bits), Ty::F64),
            Type::Bool => self.b.const_i32(i32::from(bits & 0xff != 0)),
            _ => {
                let shift = 64 - size as u32 * 8;
                let value = if ty.is_integer() && self.tcx.is_signed(&ty) {
                    ((bits << shift) as i64) >> shift
                } else {
                    bits as i64
                };
                self.b.const_int(self.mty(&ty), value)
            }
        }))
    }

    fn func_addr(&mut self, id: FuncId) -> Res<V> {
        Ok(match self.m.func_index[id as usize] {
            Some(index) => self.b.def(Inst::FuncAddr(index), Ty::I64),
            None => {
                let index = self.m.extern_for(id)?;
                self.b.def(Inst::ExternAddr(index), Ty::I64)
            }
        })
    }

    /// Loads `bytes` (1 to 8) bytes at `addr + offset` without touching anything beyond
    /// them, as an I32 (up to 4 bytes) or I64, zero-extended.
    fn load_bytes(&mut self, addr: V, offset: i64, bytes: u64, volatile: bool) -> V {
        let wide = bytes > 4;
        let part = |g: &mut Self, at: i64, n: u64| -> V {
            let kind = match n {
                1 => MemKind::I8U,
                2 => MemKind::I16U,
                4 => MemKind::I32,
                _ => MemKind::I64,
            };
            g.load_memory(kind, addr, offset + at, volatile)
        };
        if matches!(bytes, 1 | 2 | 4 | 8) {
            return part(self, 0, bytes);
        }
        // 3, 5, 6 or 7 bytes: the largest power of two first, then the rest shifted into place.
        let head = if bytes > 4 { 4 } else { 2 };
        let low = part(self, 0, head);
        let rest = self.load_bytes(addr, offset + head as i64, bytes - head, volatile);
        let (low, rest) = if wide {
            let rest = if self.b.value_ty(rest) == Ty::I32 {
                self.b.un(UnOp::ZExt32, rest)
            } else {
                rest
            };
            (self.b.un(UnOp::ZExt32, low), rest)
        } else {
            (low, rest)
        };
        let shift = self.b.const_i32((head * 8) as i32);
        let high = self.b.bin(CBin::Shl, rest, shift);
        self.b.bin(CBin::Or, low, high)
    }

    /// Stores the low `bytes` (1 to 8) bytes of integer `v` at `addr + offset`, and nothing else.
    fn store_bytes(&mut self, v: V, addr: V, offset: i64, bytes: u64, volatile: bool) {
        let wide = self.b.value_ty(v) == Ty::I64;
        if matches!(bytes, 1 | 2 | 4 | 8) {
            let (kind, narrow) = match bytes {
                1 => (MemKind::I8U, true),
                2 => (MemKind::I16U, true),
                4 => (MemKind::I32, true),
                _ => (MemKind::I64, false),
            };
            let value = if narrow && wide {
                self.b.un(UnOp::Trunc, v)
            } else {
                v
            };
            self.store_memory(kind, value, addr, offset, volatile);
            return;
        }
        let head = if bytes > 4 { 4 } else { 2 };
        self.store_bytes(v, addr, offset, head, volatile);
        let shift = self.b.const_i32((head * 8) as i32);
        let rest = self.b.bin(CBin::ShrU, v, shift);
        self.store_bytes(rest, addr, offset + head as i64, bytes - head, volatile);
    }

    /// The value that carries `piece` of the aggregate at `addr`.
    fn load_piece(&mut self, addr: V, piece: &Piece) -> V {
        match piece.ty {
            Ty::F32 => self.b.load(MemKind::F32, addr, piece.offset as i64),
            Ty::F64 => self.b.load(MemKind::F64, addr, piece.offset as i64),
            Ty::V128 => self.b.load(MemKind::V128, addr, piece.offset as i64),
            _ if piece.bytes == 0 => self.b.const_i64(0),
            _ => self.load_bytes(addr, piece.offset as i64, piece.bytes, false),
        }
    }

    fn store_piece(&mut self, v: V, addr: V, piece: &Piece) {
        match piece.ty {
            Ty::F32 => self
                .b
                .effect(Inst::Store(MemKind::F32, v, addr, piece.offset as i64)),
            Ty::F64 => self
                .b
                .effect(Inst::Store(MemKind::F64, v, addr, piece.offset as i64)),
            Ty::V128 => self
                .b
                .effect(Inst::Store(MemKind::V128, v, addr, piece.offset as i64)),
            _ if piece.bytes == 0 => {}
            _ => self.store_bytes(v, addr, piece.offset as i64, piece.bytes, false),
        }
    }

    /// A fresh stack slot for an object of type `ty`; returns its address.
    fn temp_object(&mut self, ty: &Type) -> V {
        let size = self.tcx.size_of(ty).unwrap_or(0).max(1);
        let align = self.tcx.align_of(ty).unwrap_or(1).max(1);
        let slot = self.b.add_slot(size, align);
        self.b.def(Inst::SlotAddr(slot), Ty::I64)
    }

    fn gen_call(&mut self, callee: &Expr, args: &[Expr]) -> Res<Option<V>> {
        let loc = callee.loc;
        let want_wide_result = std::mem::take(&mut self.want_wide_result);
        let (target, fty) = self.callee_of(callee)?;
        // The call was checked against a `T f();` declaration: its arguments have their
        // promoted types. If the definition is in this unit and takes that many, they are
        // converted to its parameter types; otherwise the call goes through a signature
        // made of what is passed.
        let checked_unprototyped =
            matches!(callee.ty.pointee(), Some(Type::Func(site)) if site.unprototyped);
        let matches_definition = !fty.unprototyped
            && args.len() >= fty.params.len()
            && (args.len() == fty.params.len() || fty.variadic);
        let own_signature = checked_unprototyped && !matches_definition;
        let mut arg_types: Vec<Type> = args.iter().map(|a| a.ty.clone()).collect();
        if checked_unprototyped && matches_definition {
            for (ty, param) in arg_types.iter_mut().zip(&fty.params) {
                if ty.is_value() && param.is_value() {
                    ty.clone_from(param);
                }
            }
        }

        // Evaluate every argument first: scalars to their value, aggregates to their address.
        let any_cf_after = |from: usize| args[from..].iter().any(|a| a.has_control_flow);
        let held_pointer = match target {
            Callee::Indirect(v) => Some(self.hold(v, any_cf_after(0))),
            _ => None,
        };
        let mut held = Vec::with_capacity(args.len());
        let mut wide_arguments: Vec<Option<(V, V)>> = vec![None; args.len()];
        for (i, arg) in args.iter().enumerate() {
            // A 128-bit argument that nothing after it can separate from the call.
            if arg.ty.is_int128()
                && arg_types[i].is_int128()
                && !arg.has_control_flow
                && !any_cf_after(i + 1)
            {
                let wide = self.gen_wide(arg)?;
                let high = self.high_value(wide);
                wide_arguments[i] = Some((wide.low, high));
                held.push(self.hold(wide.low, false));
                continue;
            }
            let v = self.gen_value(arg)?;
            let v = if arg.ty != arg_types[i] {
                self.convert(v, &arg.ty, &arg_types[i], loc)?
            } else {
                v
            };
            held.push(self.hold(v, any_cf_after(i + 1)));
        }
        let handles: Vec<V> = held.into_iter().map(|h| self.release(h)).collect();
        let target = match (target, held_pointer) {
            (Callee::Indirect(_), Some(h)) => Callee::Indirect(self.release(h)),
            (target, _) => target,
        };
        self.wide_arguments = wide_arguments;
        self.want_wide_result = want_wide_result;
        if own_signature {
            // On x86-64 System V a callee that turns out to be variadic wants the count of
            // vector registers in %al, which is what a variadic signature asks for.
            let target_is_sysv_x64 = self.tcx.target.arch == crate::types::Arch::X86_64
                && self.tcx.target.os != crate::types::Os::Windows;
            return self.emit_call(
                target,
                &fty.ret,
                &arg_types,
                arg_types.len(),
                target_is_sysv_x64,
                true,
                &handles,
                loc,
            );
        }
        self.emit_call(
            target,
            &fty.ret,
            &arg_types,
            fty.params.len(),
            fty.variadic,
            false,
            &handles,
            loc,
        )
    }

    /// Makes a call whose arguments are already evaluated (`handles`: scalars by value,
    /// aggregates by address), laying them out the way the ABI wants.
    fn emit_call(
        &mut self,
        target: Callee,
        ret: &Type,
        arg_types: &[Type],
        named: usize,
        variadic: bool,
        own_signature: bool,
        handles: &[V],
        loc: Loc,
    ) -> Res<Option<V>> {
        let abi = self.m.call_abi(ret, arg_types, named, loc)?;
        let wide_arguments = std::mem::take(&mut self.wide_arguments);
        let halves =
            |pieces: &[abi::Piece]| pieces.len() == 2 && pieces.iter().all(|p| p.ty == Ty::I64);
        let want_wide_result = std::mem::take(&mut self.want_wide_result)
            && ret.is_int128()
            && matches!(&abi.ret, RetPass::Pieces(p) if halves(p));
        let mut values: Vec<V> = Vec::with_capacity(handles.len() + 1);
        let result_object = match abi.ret {
            RetPass::Pieces(_) if want_wide_result => None,
            RetPass::Pieces(_) | RetPass::HiddenPointer | RetPass::Indirect | RetPass::X87 => {
                Some(self.temp_object(ret))
            }
            _ => None,
        };
        if let (RetPass::HiddenPointer | RetPass::Indirect, Some(address)) =
            (&abi.ret, result_object)
        {
            values.push(address);
        }
        for (index, ((arg_ty, pass), &handle)) in
            arg_types.iter().zip(&abi.args).zip(handles).enumerate()
        {
            let wide = wide_arguments.get(index).copied().flatten();
            // Computed as two values but wanted in memory: put it there.
            let handle = match (wide, pass) {
                (Some(_), ArgPass::Pieces(pieces)) if halves(pieces) => handle,
                (Some((low, high)), _) => self.make_pair(arg_ty, low, high),
                (None, _) => handle,
            };
            match pass {
                ArgPass::Scalar(_) | ArgPass::Stack { .. } => values.push(handle),
                ArgPass::Pieces(pieces) if wide.is_some() && halves(pieces) => {
                    if let Some((low, high)) = wide {
                        values.push(low);
                        values.push(high);
                    }
                }
                ArgPass::Pieces(pieces) => {
                    for piece in pieces {
                        let v = self.load_piece(handle, piece);
                        values.push(v);
                    }
                }
                ArgPass::Reference => {
                    // The callee may modify what it is given, so it gets a copy.
                    let copy = self.temp_object(arg_ty);
                    if arg_ty.is_vector() {
                        self.b.effect(Inst::Store(MemKind::V128, handle, copy, 0));
                    } else {
                        let n = self
                            .b
                            .const_i64(self.tcx.size_of(arg_ty).unwrap_or(0) as i64);
                        self.b.effect(Inst::MemCopy(copy, handle, n));
                    }
                    values.push(copy);
                }
                ArgPass::Ignore => {}
            }
        }

        // A variadic argument that has to be copied to the stack cannot be described by the
        // callee's own signature, so such a call goes through one written for this call site.
        let needs_call_site_sig = abi
            .anonymous_params
            .iter()
            .any(|p| matches!(p, bir::Param::ByValStack { .. }));
        let through_pointer = needs_call_site_sig || own_signature;
        let pointer = match target {
            Callee::Indirect(v) => Some(v),
            Callee::Func(index) if through_pointer => {
                Some(self.b.def(Inst::FuncAddr(index), Ty::I64))
            }
            Callee::Extern(index) if through_pointer => {
                Some(self.b.def(Inst::ExternAddr(index), Ty::I64))
            }
            _ => None,
        };
        let (inst, native) = match (target, pointer) {
            (_, Some(pointer)) => {
                let mut params = abi.named_params.clone();
                if needs_call_site_sig {
                    params.extend(abi.anonymous_params.iter().copied());
                }
                let sig = self.m.intern_sig(bir::Sig {
                    rets: abi.rets.clone(),
                    variadic,
                    params,
                });
                (Inst::CallIndirect(sig, pointer, values), true)
            }
            (Callee::Func(index), None) => (Inst::Call(index, values), false),
            (Callee::Extern(index), None) => (Inst::CallExtern(index, values), true),
            (Callee::Indirect(_), None) => return internal(loc, "indirect call without a pointer"),
        };
        match (&abi.ret, result_object) {
            (RetPass::Scalar(ty), _) => {
                let v = self.b.def(inst, *ty);
                // Native ABIs leave the bits above a narrow return value unspecified.
                Ok(Some(if native && self.tcx.is_narrow(ret) {
                    self.normalize_native(v, ret)
                } else {
                    v
                }))
            }
            (RetPass::Pieces(_), None) if want_wide_result => {
                let first = self.b.def_many(inst, &abi.rets);
                self.wide_result = Some((first, first + 1));
                Ok(Some(first))
            }
            (RetPass::Pieces(pieces), Some(object)) => {
                let first = self.b.def_many(inst, &abi.rets);
                for (k, piece) in pieces.iter().enumerate() {
                    self.store_piece(first + k as V, object, piece);
                }
                Ok(Some(object))
            }
            (RetPass::HiddenPointer, Some(object)) => {
                self.b.def(inst, Ty::I64);
                Ok(Some(object))
            }
            (RetPass::Indirect, Some(object)) => {
                self.b.effect(inst);
                Ok(Some(object))
            }
            (RetPass::X87, Some(object)) => {
                // Nothing may come between the call and taking its result off the x87 stack.
                self.b.effect(inst);
                self.x87(crate::x87::X87Op::StoreResult, vec![object]);
                Ok(Some(object))
            }
            _ => {
                self.b.effect(inst);
                // An empty struct still needs somewhere to live.
                Ok(if ret.is_struct() {
                    Some(self.temp_object(ret))
                } else {
                    None
                })
            }
        }
    }

    /// Normalises a narrow value received from native code (a `_Bool` is only guaranteed in bit 0..7).
    fn normalize_native(&mut self, v: V, ty: &Type) -> V {
        if matches!(ty, Type::Bool) {
            let mask = self.b.const_i32(0xff);
            let low = self.b.bin(CBin::And, v, mask);
            let zero = self.b.const_i32(0);
            return self.b.bin(CBin::Ne, low, zero);
        }
        self.normalize(v, ty)
    }

    fn gen_expr(&mut self, e: &Expr) -> Res<Option<V>> {
        let loc = e.loc;
        let result_unused = std::mem::take(&mut self.result_unused);
        Ok(Some(match &e.kind {
            ExprKind::IntLit(v) if e.ty.is_pair() => self.pair_literal(&e.ty, *v),
            ExprKind::IntLit(v) => self.b.const_int(self.mty(&e.ty), *v),
            ExprKind::FloatLit(v) => match e.ty {
                Type::Float => self.b.def(Inst::ConstF32((*v as f32).to_bits()), Ty::F32),
                _ => self.b.def(Inst::ConstF64(v.to_bits()), Ty::F64),
            },
            ExprKind::LongDoubleLit(v) => self.long_double_constant(*v),
            ExprKind::Local(_)
            | ExprKind::Global(_)
            | ExprKind::StrLit(_)
            | ExprKind::Deref(_)
            | ExprKind::Member(..)
            | ExprKind::BitField { .. } => {
                if e.ty.is_func() {
                    return internal(loc, "function designator used as a value");
                }
                if let Some(known) = self.fold_constant_load(e)? {
                    return Ok(Some(known));
                }
                let place = self.gen_place(e)?;
                self.load_place(place, &e.ty, loc)?
            }
            ExprKind::Func(id) => self.func_addr(*id)?,
            ExprKind::Alloca(size, align) => {
                let bytes = self.gen_value(size)?;
                self.b.def(Inst::StackAlloc(bytes, *align), Ty::I64)
            }
            ExprKind::VecElem(..) if e.is_lvalue() => {
                let place = self.gen_place(e)?;
                self.load_place(place, &e.ty, loc)?
            }
            ExprKind::VecSplat(_)
            | ExprKind::VecInit(_)
            | ExprKind::VecElem(..)
            | ExprKind::VecBuiltin(..)
            | ExprKind::Atomic(_) => return self.gen_simd_expr(e),
            ExprKind::ComplexMake(re, im) => self.gen_complex_make(e, re, im)?,
            ExprKind::TransparentUnion(value) => {
                let v = self.gen_value(value)?;
                let object = self.temp_object(&e.ty);
                let kind = self.tcx.mem_kind(&value.ty, true);
                self.b.effect(Inst::Store(kind, v, object, 0));
                object
            }
            ExprKind::ComplexPart(base, imag) => {
                if e.is_lvalue() {
                    let place = self.gen_place(e)?;
                    self.load_place(place, &e.ty, loc)?
                } else {
                    let address = self.gen_value(base)?;
                    let part = FnGen::complex_part_offset(&base.ty, *imag);
                    self.b.load(self.tcx.mem_kind(&e.ty, false), address, part)
                }
            }
            ExprKind::Neg(_) | ExprKind::BitNot(_) if Self::is_wide_operation(e) => {
                let wide = self.gen_wide(e)?;
                let object = self.temp_object(&e.ty);
                self.store_wide(object, wide);
                object
            }
            ExprKind::Binary(op, a, b)
                if op.is_compare() && a.ty.is_int128() && !e.has_control_flow =>
            {
                let signed = self.tcx.is_signed(&a.ty);
                let x = self.gen_wide(a)?;
                let y = self.gen_wide(b)?;
                let x = (x.low, self.high_value(x));
                let y = (y.low, self.high_value(y));
                self.int128_compare(*op, x, y, signed)
            }
            ExprKind::Neg(a) if e.ty.is_long_double() => {
                let v = self.gen_value(a)?;
                self.long_double_negated(v)
            }
            ExprKind::Neg(a) | ExprKind::BitNot(a) if e.ty.is_pair() => {
                let v = self.gen_value(a)?;
                let negate = matches!(e.kind, ExprKind::Neg(_));
                self.gen_pair_unary(negate, &e.ty, v, loc)?
            }
            ExprKind::LogNot(a) if a.ty.is_pair() => {
                let truth = self.gen_truth(a)?;
                let one = self.b.const_i32(1);
                self.b.bin(CBin::Xor, truth, one)
            }
            ExprKind::Neg(a) if e.ty.is_vector() => {
                let v = self.gen_value(a)?;
                self.gen_vec_neg(&e.ty, v, loc)?
            }
            ExprKind::BitNot(a) if e.ty.is_vector() => {
                let v = self.gen_value(a)?;
                self.gen_vec_not(&e.ty, v)
            }
            ExprKind::Neg(a) => {
                let v = self.gen_value(a)?;
                self.b.un(UnOp::Neg, v)
            }
            ExprKind::BitNot(a) => {
                let v = self.gen_value(a)?;
                let ones = self.b.const_int(self.b.value_ty(v), -1);
                self.b.bin(CBin::Xor, v, ones)
            }
            ExprKind::LogNot(a) => {
                let v = self.gen_value(a)?;
                let zero = self.zero(self.b.value_ty(v));
                self.b.bin(CBin::Eq, v, zero)
            }
            ExprKind::Binary(..) | ExprKind::Cast(_) if Self::is_wide_operation(e) => {
                let wide = self.gen_wide(e)?;
                let object = self.temp_object(&e.ty);
                self.store_wide(object, wide);
                object
            }
            ExprKind::Binary(op, a, b) => {
                if matches!(op, BinOp::Or | BinOp::Add | BinOp::Xor)
                    && e.ty.is_integer()
                    && !e.ty.is_pair()
                {
                    if let Some(run) = self.byte_run(e) {
                        return Ok(Some(self.gen_byte_run(&run, &e.ty)?));
                    }
                }
                let va = self.gen_value(a)?;
                let ha = self.hold(va, b.has_control_flow);
                let vb = self.gen_value(b)?;
                let va = self.release(ha);
                if a.ty.is_vector() {
                    self.gen_vec_binary(*op, &a.ty, va, vb, &b.ty, loc)?
                } else if a.ty.is_long_double() {
                    self.long_double_binary(*op, va, vb, loc)?
                } else if a.ty.is_pair() {
                    self.gen_pair_binary(*op, &a.ty, va, vb, loc)?
                } else {
                    self.b.bin(self.arith_op(*op, &a.ty), va, vb)
                }
            }
            ExprKind::PtrAdd {
                ptr,
                index,
                scale,
                sub,
            } => {
                let vp = self.gen_value(ptr)?;
                if let ExprKind::IntLit(i) = index.kind {
                    let delta = i.wrapping_mul(*scale as i64);
                    if delta == 0 {
                        vp
                    } else {
                        let d = self
                            .b
                            .const_i64(if *sub { delta.wrapping_neg() } else { delta });
                        self.b.bin(CBin::Add, vp, d)
                    }
                } else {
                    let hp = self.hold(vp, index.has_control_flow);
                    let vi = self.gen_value(index)?;
                    let vp = self.release(hp);
                    self.emit_ptr_add(vp, vi, *scale, *sub)
                }
            }
            ExprKind::PtrDiff { a, b, scale } => {
                let va = self.gen_value(a)?;
                let ha = self.hold(va, b.has_control_flow);
                let vb = self.gen_value(b)?;
                let va = self.release(ha);
                let bytes = self.b.bin(CBin::Sub, va, vb);
                if *scale <= 1 {
                    bytes
                } else {
                    let s = self.b.const_i64(*scale as i64);
                    self.b.bin(CBin::Div, bytes, s)
                }
            }
            ExprKind::LogAnd(..) | ExprKind::LogOr(..) => {
                let (then_block, else_block, end) =
                    (self.b.new_block(), self.b.new_block(), self.b.new_block());
                let temp = self.alloc_temp(Ty::I32);
                self.gen_cond(e, then_block, else_block)?;
                for (block, value) in [(then_block, 1), (else_block, 0)] {
                    self.b.switch_to(block);
                    let v = self.b.const_i32(value);
                    self.b.effect(Inst::LocalSet(temp, v));
                    self.b.terminate(Inst::Jump(end));
                }
                self.b.switch_to(end);
                let v = self.b.local_get(temp);
                self.free_temp(temp, Ty::I32);
                v
            }
            ExprKind::Cond(c, a, b) => return self.gen_conditional(e, c, a, b),
            ExprKind::Assign(lhs, rhs) => {
                if let Some((low, high)) = self.halves_of(lhs) {
                    let wide = self.gen_wide_any(rhs)?;
                    self.set_halves(low, high, wide);
                    if result_unused {
                        return Ok(None);
                    }
                    let high = self.high_value(wide);
                    self.make_pair(&e.ty, wide.low, high)
                } else if Self::is_wide_operation(rhs)
                    && !lhs.ty.is_volatile()
                    && !lhs.ty.is_atomic()
                {
                    // The halves go straight to where they belong.
                    let place = self.gen_place(lhs)?;
                    let dst = self.place_addr(place, loc)?;
                    let wide = self.gen_wide(rhs)?;
                    self.store_wide(dst, wide);
                    dst
                } else if let (true, Some(to)) = (e.ty.is_struct(), self.leaves_of_object(lhs)) {
                    // Into a replaced aggregate, element by element.
                    match self.leaves_of_object(rhs) {
                        Some(from) => self.move_leaves(&to, &from, loc)?,
                        None => {
                            let from = self.gen_value(rhs)?;
                            self.load_leaves(&to, from);
                        }
                    }
                    return Ok(None);
                } else if let (true, Some(from)) = (e.ty.is_struct(), self.leaves_of_object(rhs)) {
                    let place = self.gen_place(lhs)?;
                    let dst = self.place_addr(place, loc)?;
                    self.store_leaves(&from, dst);
                    dst
                } else if e.ty.is_struct() || e.ty.is_pair() || e.ty.is_long_double() {
                    let size = self.tcx.size_of(&e.ty).unwrap_or(0);
                    let place = self.gen_place(lhs)?;
                    let dst = self.place_addr(place, loc)?;
                    let hd = self.hold(dst, rhs.has_control_flow);
                    let src = self.gen_value(rhs)?;
                    let dst = self.release(hd);
                    let n = self.b.const_i64(size as i64);
                    self.b.effect(Inst::MemCopy(dst, src, n));
                    dst
                } else {
                    let place = self.gen_place(lhs)?;
                    let (held, place) = self.hold_place(place, rhs.has_control_flow);
                    // `*p = (unsigned short)x;` as a statement: the store does the narrowing.
                    let narrowed = match &rhs.kind {
                        ExprKind::Cast(inner)
                            if result_unused
                                && self.store_truncates(place, &lhs.ty)
                                && inner.ty.is_integer()
                                && !inner.ty.is_pair() =>
                        {
                            Some(inner)
                        }
                        _ => None,
                    };
                    let v = match narrowed {
                        Some(inner) => {
                            let wide = self.gen_value(inner)?;
                            self.low_word(wide)
                        }
                        None => self.gen_value(rhs)?,
                    };
                    let place = self.release_place(held, place);
                    self.store_place(place, &lhs.ty, v, loc)?
                }
            }
            ExprKind::CompoundAssign {
                lhs,
                rhs,
                op,
                op_ty,
            } if self.halves_of(lhs).is_some() => {
                let Some((low, high)) = self.halves_of(lhs) else {
                    return internal(loc, "128-bit variable without its halves");
                };
                let CompoundOp::Arith(bop) = op else {
                    return internal(loc, "pointer arithmetic on a 128-bit variable");
                };
                let old = pair::Wide {
                    low: self.b.local_get(low),
                    high: pair::High::Value(self.b.local_get(high)),
                };
                let direct = op_ty.is_int128()
                    && !rhs.has_control_flow
                    && matches!(
                        bop,
                        BinOp::Add | BinOp::Sub | BinOp::Mul | BinOp::And | BinOp::Or | BinOp::Xor
                    );
                let new = if direct {
                    let operand = self.gen_wide(rhs)?;
                    self.wide_binary(*bop, old, operand)
                } else {
                    // Through memory, like any other object.
                    let old_high = self.high_value(old);
                    let object = self.make_pair(&lhs.ty, old.low, old_high);
                    let held = self.hold(object, rhs.has_control_flow);
                    let vr = self.gen_value(rhs)?;
                    let object = self.release(held);
                    let widened = self.convert(object, &lhs.ty, op_ty, loc)?;
                    let result = if op_ty.is_pair() {
                        self.gen_pair_binary(*bop, op_ty, widened, vr, loc)?
                    } else {
                        self.b.bin(self.arith_op(*bop, op_ty), widened, vr)
                    };
                    let result = self.convert(result, op_ty, &lhs.ty, loc)?;
                    let (low, high) = self.load_pair(result, lhs.ty.unatomic());
                    pair::Wide {
                        low,
                        high: pair::High::Value(high),
                    }
                };
                self.set_halves(low, high, new);
                if result_unused {
                    return Ok(None);
                }
                let new_high = self.high_value(new);
                self.make_pair(&e.ty, new.low, new_high)
            }
            ExprKind::CompoundAssign {
                lhs,
                rhs,
                op,
                op_ty,
            } => {
                let place = self.gen_place(lhs)?;
                let (held, place) = self.hold_place(place, rhs.has_control_flow);
                let vr = self.gen_value(rhs)?;
                let place = self.release_place(held, place);
                let old = self.load_place(place, &lhs.ty, loc)?;
                let new = match op {
                    CompoundOp::PtrAdd { scale, sub } => self.emit_ptr_add(old, vr, *scale, *sub),
                    CompoundOp::Arith(bop) if op_ty.is_vector() => {
                        self.gen_vec_binary(*bop, op_ty, old, vr, &rhs.ty, loc)?
                    }
                    CompoundOp::Arith(bop)
                        if op_ty.is_int128()
                            && lhs.ty.unatomic().is_int128()
                            && !rhs.has_control_flow
                            && matches!(
                                bop,
                                BinOp::Add
                                    | BinOp::Sub
                                    | BinOp::Mul
                                    | BinOp::And
                                    | BinOp::Or
                                    | BinOp::Xor
                            ) =>
                    {
                        // `old` and `vr` are addresses.
                        let (low, high) = self.load_pair(old, op_ty);
                        let x = pair::Wide {
                            low,
                            high: pair::High::Value(high),
                        };
                        let (low, high) = self.load_pair(vr, op_ty);
                        let y = pair::Wide {
                            low,
                            high: pair::High::Value(high),
                        };
                        let result = self.wide_binary(*bop, x, y);
                        let object = self.temp_object(op_ty);
                        self.store_wide(object, result);
                        object
                    }
                    CompoundOp::Arith(bop) if op_ty.is_pair() => {
                        let widened = self.convert(old, &lhs.ty, op_ty, loc)?;
                        let result = self.gen_pair_binary(*bop, op_ty, widened, vr, loc)?;
                        self.convert(result, op_ty, &lhs.ty, loc)?
                    }
                    CompoundOp::Arith(bop) if op_ty.is_long_double() => {
                        let widened = self.convert(old, &lhs.ty, op_ty, loc)?;
                        let result = self.long_double_binary(*bop, widened, vr, loc)?;
                        self.convert(result, op_ty, &lhs.ty, loc)?
                    }
                    CompoundOp::Arith(bop) => {
                        let widened = self.convert(old, &lhs.ty, op_ty, loc)?;
                        let result = self.b.bin(self.arith_op(*bop, op_ty), widened, vr);
                        if result_unused
                            && op_ty.is_integer()
                            && self.store_truncates(place, &lhs.ty)
                        {
                            self.low_word(result)
                        } else {
                            self.convert(result, op_ty, &lhs.ty, loc)?
                        }
                    }
                };
                self.store_place(place, &lhs.ty, new, loc)?
            }
            ExprKind::IncDec { lhs, inc, post, .. } if self.halves_of(lhs).is_some() => {
                let Some((low, high)) = self.halves_of(lhs) else {
                    return internal(loc, "128-bit variable without its halves");
                };
                let old = pair::Wide {
                    low: self.b.local_get(low),
                    high: pair::High::Value(self.b.local_get(high)),
                };
                let one = pair::Wide {
                    low: self.b.const_i64(1),
                    high: pair::High::Zero,
                };
                let op = if *inc { BinOp::Add } else { BinOp::Sub };
                let new = self.wide_binary(op, old, one);
                self.set_halves(low, high, new);
                if result_unused {
                    return Ok(None);
                }
                let value = if *post { old } else { new };
                let value_high = self.high_value(value);
                self.make_pair(&e.ty, value.low, value_high)
            }
            ExprKind::IncDec {
                lhs,
                inc,
                post,
                scale,
                dynamic_scale,
            } => {
                let place = self.gen_place(lhs)?;
                let (held, place) = self.hold_place(
                    place,
                    dynamic_scale.as_ref().is_some_and(|s| s.has_control_flow),
                );
                let dynamic_step = match dynamic_scale {
                    Some(step) => Some(self.gen_value(step)?),
                    None => None,
                };
                let place = self.release_place(held, place);
                let old = self.load_place(place, &lhs.ty, loc)?;
                if lhs.ty.unatomic().is_pair() {
                    // `old` is the object itself: keep a copy for the postfix result.
                    let pair_ty = lhs.ty.unatomic();
                    let (low, high) = self.load_pair(old, pair_ty);
                    let before = self.make_pair(pair_ty, low, high);
                    let one = self.pair_one(pair_ty);
                    let op = if *inc { BinOp::Add } else { BinOp::Sub };
                    let new = self.gen_pair_binary(op, pair_ty, before, one, loc)?;
                    self.store_place(place, &lhs.ty, new, loc)?;
                    return Ok(Some(if *post { before } else { new }));
                }
                if lhs.ty.unatomic().is_long_double() {
                    // `old` is the object itself: the postfix result is a copy made before.
                    let before = if *post && !result_unused {
                        Some(self.long_double_copy(old))
                    } else {
                        None
                    };
                    let one = self.long_double_one();
                    let op = if *inc { BinOp::Add } else { BinOp::Sub };
                    let new = self.long_double_binary(op, old, one, loc)?;
                    self.store_place(place, &lhs.ty, new, loc)?;
                    return Ok(Some(before.unwrap_or(new)));
                }
                let mty = self.b.value_ty(old);
                let new = if mty.is_float() {
                    let one = if mty == Ty::F32 {
                        self.b.def(Inst::ConstF32(1f32.to_bits()), Ty::F32)
                    } else {
                        self.b.def(Inst::ConstF64(1f64.to_bits()), Ty::F64)
                    };
                    self.b
                        .bin(if *inc { CBin::Add } else { CBin::Sub }, old, one)
                } else {
                    let step = match dynamic_step {
                        Some(step) => step,
                        None => self.b.const_int(mty, *scale as i64),
                    };
                    let raw = self
                        .b
                        .bin(if *inc { CBin::Add } else { CBin::Sub }, old, step);
                    let stored_only = result_unused && self.store_truncates(place, &lhs.ty);
                    if self.tcx.is_narrow(&lhs.ty) && !stored_only {
                        self.normalize(raw, &lhs.ty)
                    } else {
                        raw
                    }
                };
                let stored = self.store_place(place, &lhs.ty, new, loc)?;
                if *post { old } else { stored }
            }
            ExprKind::Comma(a, b) => {
                self.gen_discard(a)?;
                return self.gen_expr(b);
            }
            ExprKind::Cast(inner) => {
                if e.ty.is_void() {
                    self.gen_discard(inner)?;
                    return Ok(None);
                }
                // The low half of a 128-bit computation.
                let to = e.ty.unatomic();
                if inner.ty.is_int128()
                    && !inner.has_control_flow
                    && (Self::is_wide_operation(inner) || self.halves_of(inner).is_some())
                    && to.is_integer()
                    && !to.is_pair()
                    && !matches!(to, Type::Bool)
                {
                    let wide = self.gen_wide(inner)?;
                    return Ok(Some(self.convert(wide.low, &Type::ULLong, to, loc)?));
                }
                let v = self.gen_value(inner)?;
                self.convert(v, &inner.ty, &e.ty, loc)?
            }
            ExprKind::AddrOf(inner) => {
                let place = self.gen_place(inner)?;
                self.place_addr(place, loc)?
            }
            ExprKind::Decay(inner) => {
                if inner.ty.is_func() {
                    match &inner.kind {
                        ExprKind::Func(id) => self.func_addr(*id)?,
                        ExprKind::Deref(ptr) => self.gen_value(ptr)?,
                        _ => return internal(loc, "unexpected function designator"),
                    }
                } else if inner.is_lvalue() {
                    let place = self.gen_place(inner)?;
                    self.place_addr(place, loc)?
                } else {
                    // An array inside a struct rvalue, e.g. `(c ? s1 : s2).arr`.
                    self.gen_value(inner)?
                }
            }
            ExprKind::Call { callee, args } => return self.gen_call(callee, args),
            ExprKind::StmtExpr { stmts, result } => {
                self.gen_stmts(stmts, loc)?;
                return match result {
                    Some(result) => self.gen_expr(result),
                    None => Ok(None),
                };
            }
            ExprKind::CompoundLiteral { .. } => {
                let place = self.gen_place(e)?;
                self.load_place(place, &e.ty, loc)?
            }
            ExprKind::Intrinsic(op, args) => return self.gen_intrinsic(e, *op, args),
            ExprKind::Unsupported(message) => return err(loc, message.to_string()),
            ExprKind::VaStart(ap) => {
                let address = self.gen_value(ap)?;
                self.b.effect(Inst::VaStart(address));
                return Ok(None);
            }
            ExprKind::VaArg(ap) if e.ty.is_struct() || e.ty.is_pair() || e.ty.is_long_double() => {
                let list = self.gen_value(ap)?;
                self.gen_va_arg_aggregate(list, &e.ty, loc)?
            }
            ExprKind::VaArg(ap) => {
                let list = self.gen_value(ap)?;
                let in_float_register = e.ty.is_float()
                    || (self.tcx.is_half_vector(&e.ty) && self.mty(&e.ty) == Ty::F64);
                let address = self.gen_va_arg_address(list, in_float_register);
                self.b.load(self.tcx.mem_kind(&e.ty, false), address, 0)
            }
            ExprKind::VaCopy(dst, src) => {
                let d = self.gen_value(dst)?;
                let hd = self.hold(d, src.has_control_flow);
                let from = self.gen_value(src)?;
                let d = self.release(hd);
                let size = self.m.prog.va_list_size;
                let n = self.b.const_i64(size as i64);
                self.b.effect(Inst::MemCopy(d, from, n));
                return Ok(None);
            }
        }))
    }

    fn gen_conditional(&mut self, e: &Expr, c: &Expr, a: &Expr, b: &Expr) -> Res<Option<V>> {
        if e.ty.is_void() {
            let (then_block, else_block, end) =
                (self.b.new_block(), self.b.new_block(), self.b.new_block());
            self.gen_cond(c, then_block, else_block)?;
            for (block, arm) in [(then_block, a), (else_block, b)] {
                self.b.switch_to(block);
                self.gen_discard(arm)?;
                self.b.terminate(Inst::Jump(end));
            }
            self.b.switch_to(end);
            return Ok(None);
        }
        if e.ty.is_value() && !c.has_control_flow && self.is_trivial(a) && self.is_trivial(b) {
            let vc = self.gen_condition(c)?;
            let va = self.gen_value(a)?;
            let vb = self.gen_value(b)?;
            return Ok(Some(self.b.def(Inst::Select(vc, va, vb), self.mty(&e.ty))));
        }
        let mty = self.mty(&e.ty);
        let (then_block, else_block, end) =
            (self.b.new_block(), self.b.new_block(), self.b.new_block());
        let temp = self.alloc_temp(mty);
        self.gen_cond(c, then_block, else_block)?;
        for (block, arm) in [(then_block, a), (else_block, b)] {
            self.b.switch_to(block);
            let v = self.gen_value(arm)?;
            self.b.effect(Inst::LocalSet(temp, v));
            self.b.terminate(Inst::Jump(end));
        }
        self.b.switch_to(end);
        let v = self.b.local_get(temp);
        self.free_temp(temp, mty);
        Ok(Some(v))
    }

    // ───────────────────────────── statements ─────────────────────────────

    fn label_block(&mut self, label: LabelId) -> u32 {
        if let Some(block) = self.labels[label as usize] {
            return block;
        }
        let block = self.b.new_block();
        self.labels[label as usize] = Some(block);
        block
    }

    fn local_addr(&mut self, local: LocalId, offset: u64, loc: Loc) -> Res<V> {
        let LocalPlace::Slot(slot) = self.locals[local as usize] else {
            return internal(loc, "aggregate initializer for a register variable");
        };
        let base = self.b.def(Inst::SlotAddr(slot), Ty::I64);
        if offset == 0 {
            return Ok(base);
        }
        let delta = self.b.const_i64(offset as i64);
        Ok(self.b.bin(CBin::Add, base, delta))
    }

    fn gen_local_init(
        &mut self,
        local: LocalId,
        zero_first: bool,
        items: &[InitItem],
        loc: Loc,
    ) -> Res<()> {
        if let LocalPlace::Scalars(_) = self.locals[local as usize] {
            return self.init_leaves(local, zero_first, items, loc);
        }
        let ty = &self.local_types[local as usize].ty;
        if let LocalPlace::Halves(low, high) = self.locals[local as usize] {
            let [
                InitItem::Copy {
                    offset: 0, expr, ..
                },
            ] = items
            else {
                return internal(loc, "unexpected initializer for a 128-bit variable");
            };
            let wide = self.gen_wide_any(expr)?;
            self.set_halves(low, high, wide);
            return Ok(());
        }
        if let LocalPlace::Reg(reg) = self.locals[local as usize] {
            for item in items {
                let InitItem::Scalar { expr, .. } = item else {
                    return internal(loc, "non-scalar initializer for a register variable");
                };
                let v = self.gen_value(expr)?;
                self.b.effect(Inst::LocalSet(reg, v));
            }
            return Ok(());
        }
        if zero_first {
            let size = self.tcx.size_of(ty).unwrap_or(0);
            if size > 0 {
                let base = self.local_addr(local, 0, loc)?;
                let zero = self.b.const_i32(0);
                let n = self.b.const_i64(size as i64);
                self.b.effect(Inst::MemSet(base, zero, n));
            }
        }
        for item in items {
            match item {
                InitItem::Scalar { offset, expr } => {
                    let v = self.gen_value(expr)?;
                    let LocalPlace::Slot(slot) = self.locals[local as usize] else {
                        return internal(loc, "initializer target is not in memory");
                    };
                    let base = self.b.def(Inst::SlotAddr(slot), Ty::I64);
                    self.b.effect(Inst::Store(
                        self.tcx.mem_kind(&expr.ty, true),
                        v,
                        base,
                        *offset as i64,
                    ));
                }
                InitItem::Bytes { offset, bytes } => {
                    if bytes.is_empty() {
                        continue;
                    }
                    let blob = self.m.blob(bytes.clone());
                    let object = self.m.blob_object(blob);
                    let src = self.data_addr(object);
                    let dst = self.local_addr(local, *offset, loc)?;
                    let n = self.b.const_i64(bytes.len() as i64);
                    self.b.effect(Inst::MemCopy(dst, src, n));
                }
                InitItem::Copy { offset, expr, .. } if Self::is_wide_operation(expr) => {
                    let wide = self.gen_wide(expr)?;
                    let dst = self.local_addr(local, *offset, loc)?;
                    self.store_wide(dst, wide);
                }
                InitItem::Copy { offset, expr, size } => {
                    let src = self.gen_value(expr)?;
                    let dst = self.local_addr(local, *offset, loc)?;
                    let n = self.b.const_i64(*size as i64);
                    self.b.effect(Inst::MemCopy(dst, src, n));
                }
                InitItem::Bits {
                    offset,
                    field,
                    expr,
                } => {
                    let v = self.gen_value(expr)?;
                    let base = self.local_addr(local, 0, loc)?;
                    let place = Place::Bits {
                        base,
                        offset: *offset as i64,
                        field: *field,
                    };
                    self.store_place(place, &expr.ty, v, loc)?;
                }
            }
        }
        Ok(())
    }

    /// Emits a compiler builtin.
    fn gen_intrinsic(&mut self, e: &Expr, op: Intrinsic, args: &[Expr]) -> Res<Option<V>> {
        match op {
            Intrinsic::Unreachable => {
                self.b.terminate(Inst::Unreachable);
                return Ok(None);
            }
            Intrinsic::Trap => {
                self.b.terminate(Inst::Trap);
                return Ok(None);
            }
            Intrinsic::FrameAddress => {
                return Ok(Some(self.b.def(Inst::FrameAddress, Ty::I64)));
            }
            Intrinsic::Bitcast => {
                let [operand] = args else {
                    return internal(e.loc, "bitcast needs one operand");
                };
                let v = self.gen_value(operand)?;
                let to = self.mty(&e.ty);
                return Ok(Some(self.b.conv(bir::ConvOp::Bitcast, to, v)));
            }
            Intrinsic::CpuId => {
                let [leaf, subleaf, out] = args else {
                    return internal(e.loc, "cpuid needs three operands");
                };
                let leaf_v = self.gen_value(leaf)?;
                let held_leaf = self.hold(leaf_v, subleaf.has_control_flow || out.has_control_flow);
                let subleaf_v = self.gen_value(subleaf)?;
                let held_subleaf = self.hold(subleaf_v, out.has_control_flow);
                let address = self.gen_value(out)?;
                let subleaf_v = self.release(held_subleaf);
                let leaf_v = self.release(held_leaf);
                let first = self
                    .b
                    .def_many(Inst::CpuId(leaf_v, subleaf_v), &[Ty::I32; 4]);
                for k in 0..4 {
                    self.b.effect(Inst::Store(
                        MemKind::I32,
                        first + k,
                        address,
                        i64::from(k) * 4,
                    ));
                }
                return Ok(None);
            }
            Intrinsic::Barrier => {
                self.b.effect(Inst::Fence(bir::order::ACQ_REL));
                return Ok(None);
            }
            Intrinsic::X87(operation) => {
                if args.len() != operation.operand_count() {
                    return internal(
                        e.loc,
                        "a long double operation with the wrong number of operands",
                    );
                }
                let mut held = Vec::with_capacity(args.len());
                for (at, arg) in args.iter().enumerate() {
                    let value = self.gen_value(arg)?;
                    let later = args[at + 1..].iter().any(|later| later.has_control_flow);
                    held.push(self.hold(value, later));
                }
                let mut values = Vec::with_capacity(held.len());
                while let Some(held) = held.pop() {
                    values.push(self.release(held));
                }
                values.reverse();
                return Ok(self.x87(operation, values));
            }
            Intrinsic::InlineAsm(index) => {
                let Some(block) = self.m.prog.asm_blocks.get(index as usize) else {
                    return internal(e.loc, "an asm statement without its block");
                };
                if args.len() != block.input_registers.len() + block.outputs.len() {
                    return internal(e.loc, "an asm statement with the wrong number of operands");
                }
                // Every operand is evaluated before the code runs, in order.
                let mut held = Vec::with_capacity(args.len());
                for (at, arg) in args.iter().enumerate() {
                    let value = self.gen_value(arg)?;
                    let later = args[at + 1..].iter().any(|later| later.has_control_flow);
                    held.push(self.hold(value, later));
                }
                let mut values = Vec::with_capacity(held.len());
                while let Some(held) = held.pop() {
                    values.push(self.release(held));
                }
                values.reverse();
                let (inputs, addresses) = values.split_at(block.input_registers.len());
                let types: Vec<Ty> = block
                    .outputs
                    .iter()
                    .map(|(result, _)| match result {
                        crate::ast::AsmResult::I32 => Ty::I32,
                        crate::ast::AsmResult::I64 => Ty::I64,
                        crate::ast::AsmResult::F32 => Ty::F32,
                        crate::ast::AsmResult::F64 => Ty::F64,
                    })
                    .collect();
                let instruction = bir::InlineAsm {
                    flags: u8::from(block.side_effects),
                    code: block.code.clone(),
                    inputs: inputs
                        .iter()
                        .copied()
                        .zip(block.input_registers.iter().copied())
                        .collect(),
                    outputs: types
                        .iter()
                        .copied()
                        .zip(block.outputs.iter().map(|(_, register)| *register))
                        .collect(),
                    clobbers: block.clobbers.clone(),
                };
                let addresses = addresses.to_vec();
                if types.is_empty() {
                    self.b.effect(Inst::InlineAsm(Box::new(instruction)));
                    return Ok(None);
                }
                let first = self
                    .b
                    .def_many(Inst::InlineAsm(Box::new(instruction)), &types);
                for (k, (ty, address)) in types.iter().zip(addresses).enumerate() {
                    let kind = match ty {
                        Ty::I32 => MemKind::I32,
                        Ty::I64 => MemKind::I64,
                        Ty::F32 => MemKind::F32,
                        _ => MemKind::F64,
                    };
                    self.b
                        .effect(Inst::Store(kind, first + k as u32, address, 0));
                }
                return Ok(None);
            }
            Intrinsic::RotL | Intrinsic::RotR => {
                let [x, n] = args else {
                    return internal(e.loc, "a rotation needs two operands");
                };
                let value = self.gen_value(x)?;
                let held = self.hold(value, n.has_control_flow);
                let amount = self.gen_value(n)?;
                let value = self.release(held);
                let op = if op == Intrinsic::RotL {
                    CBin::RotL
                } else {
                    CBin::RotR
                };
                return Ok(Some(self.b.bin(op, value, amount)));
            }
            Intrinsic::FullBarrier => {
                self.b.effect(Inst::Fence(bir::order::SEQ_CST));
                return Ok(None);
            }
            Intrinsic::MemCopy | Intrinsic::MemSet => return self.gen_memory_builtin(e, op, args),
            Intrinsic::MulHigh => {
                let [a, b] = args else {
                    return internal(e.loc, "multiply-high needs two operands");
                };
                let x = self.gen_value(a)?;
                let held = self.hold(x, b.has_control_flow);
                let y = self.gen_value(b)?;
                let x = self.release(held);
                let op = if self.tcx.is_signed(&a.ty) {
                    CBin::MulHigh
                } else {
                    CBin::UMulHigh
                };
                return Ok(Some(self.b.bin(op, x, y)));
            }
            _ => {}
        }
        let Some(arg) = args.first() else {
            return internal(e.loc, "intrinsic without an operand");
        };
        let x = self.gen_value(arg)?;
        let wide = self.b.value_ty(x) == Ty::I64;
        let raw = match op {
            Intrinsic::Clz => self.b.un(UnOp::Clz, x),
            Intrinsic::Ctz => self.b.un(UnOp::Ctz, x),
            Intrinsic::Popcount => self.b.un(UnOp::Popcnt, x),
            _ => self.b.un(UnOp::Bswap, x),
        };
        if op == Intrinsic::Bswap {
            // A 16-bit swap is a 32-bit swap whose result sits in the upper half.
            if self.tcx.size_of(&e.ty) == Some(2) {
                let sixteen = self.b.const_i32(16);
                return Ok(Some(self.b.bin(CBin::ShrU, raw, sixteen)));
            }
            return Ok(Some(raw));
        }
        // The counting builtins return int whatever the operand's width.
        Ok(Some(if wide {
            self.b.un(UnOp::Trunc, raw)
        } else {
            raw
        }))
    }

    /// `memcpy`/`memmove`/`memset`. A statement that copies a whole scalar variable that lives
    /// in a register is a load, a store or a move of its bits.
    /// The BIR local and type of the scalar variable `operand` is the address of, when a
    /// copy of `bytes` bytes to or from it moves its whole value (see `punned_local`).
    fn punned_register(&self, operand: &Expr, bytes: u64) -> Option<(u32, Type)> {
        let id = punned_local(operand, bytes, self.local_types, self.tcx)?;
        match self.locals[id as usize] {
            LocalPlace::Reg(reg) => {
                Some((reg, self.local_types[id as usize].ty.unatomic().clone()))
            }
            _ => None,
        }
    }

    fn gen_memory_builtin(&mut self, e: &Expr, op: Intrinsic, args: &[Expr]) -> Res<Option<V>> {
        let [dst, second, n] = args else {
            return internal(e.loc, "memcpy needs three operands");
        };
        if e.ty.is_void() {
            if let Ok(crate::constexpr::Const::Int(bytes)) = crate::constexpr::eval(n, self.tcx) {
                // Ranges of replaced aggregates, element by element.
                let bytes = bytes as u64;
                let to = self.leaves_at_address(dst, bytes);
                if op == Intrinsic::MemSet {
                    if let Some(to) = to {
                        let Ok(crate::constexpr::Const::Int(byte)) =
                            crate::constexpr::eval(second, self.tcx)
                        else {
                            return internal(
                                e.loc,
                                "memset of a replaced aggregate with a variable",
                            );
                        };
                        self.fill_leaves(&to, byte as u8);
                        return Ok(None);
                    }
                } else {
                    let from = self.leaves_at_address(second, bytes);
                    match (to, from) {
                        (Some(to), Some(from)) => {
                            self.move_leaves(&to, &from, e.loc)?;
                            return Ok(None);
                        }
                        // The other side may be a scalar kept in a register (see
                        // `punned_local`): the bytes meet in a temporary.
                        (Some(to), None) => {
                            let address = match self.punned_register(second, bytes) {
                                Some((reg, ty)) => {
                                    let temp = self.temp_object(&ty);
                                    let v = self.b.local_get(reg);
                                    let kind = self.tcx.mem_kind(&ty, true);
                                    self.b.effect(Inst::Store(kind, v, temp, 0));
                                    temp
                                }
                                None => self.gen_value(second)?,
                            };
                            self.load_leaves(&to, address);
                            return Ok(None);
                        }
                        (None, Some(from)) => {
                            if let Some((reg, ty)) = self.punned_register(dst, bytes) {
                                let temp = self.temp_object(&ty);
                                self.store_leaves(&from, temp);
                                let v = self.b.load(self.tcx.mem_kind(&ty, false), temp, 0);
                                let v = self.normalize(v, &ty);
                                self.b.effect(Inst::LocalSet(reg, v));
                                return Ok(None);
                            }
                            let address = self.gen_value(dst)?;
                            self.store_leaves(&from, address);
                            return Ok(None);
                        }
                        (None, None) => {}
                    }
                }
            }
        }
        if op == Intrinsic::MemCopy && e.ty.is_void() {
            if let Ok(crate::constexpr::Const::Int(bytes)) = crate::constexpr::eval(n, self.tcx) {
                let in_register = |g: &Self, operand: &Expr| -> Option<(u32, Type)> {
                    let id = punned_local(operand, bytes as u64, g.local_types, g.tcx)?;
                    match g.locals[id as usize] {
                        LocalPlace::Reg(reg) => {
                            Some((reg, g.local_types[id as usize].ty.unatomic().clone()))
                        }
                        _ => None,
                    }
                };
                match (in_register(self, dst), in_register(self, second)) {
                    (Some((to, to_ty)), Some((from, from_ty))) => {
                        let v = self.b.local_get(from);
                        let (from_m, to_m) = (self.mty(&from_ty), self.mty(&to_ty));
                        let v = if from_m == to_m {
                            v
                        } else {
                            self.b.conv(bir::ConvOp::Bitcast, to_m, v)
                        };
                        let v = self.normalize(v, &to_ty);
                        self.b.effect(Inst::LocalSet(to, v));
                        return Ok(None);
                    }
                    (Some((to, to_ty)), None) => {
                        let address = self.gen_value(second)?;
                        let v = self.b.load(self.tcx.mem_kind(&to_ty, false), address, 0);
                        let v = self.normalize(v, &to_ty);
                        self.b.effect(Inst::LocalSet(to, v));
                        return Ok(None);
                    }
                    (None, Some((from, from_ty))) => {
                        let address = self.gen_value(dst)?;
                        let v = self.b.local_get(from);
                        let kind = self.tcx.mem_kind(&from_ty, true);
                        self.b.effect(Inst::Store(kind, v, address, 0));
                        return Ok(None);
                    }
                    (None, None) => {}
                }
            }
        }
        let d = self.gen_value(dst)?;
        let held_d = self.hold(d, second.has_control_flow || n.has_control_flow);
        let s = self.gen_value(second)?;
        let held_s = self.hold(s, n.has_control_flow);
        let count = self.gen_value(n)?;
        let s = self.release(held_s);
        let d = self.release(held_d);
        self.b.effect(if op == Intrinsic::MemCopy {
            Inst::MemCopy(d, s, count)
        } else {
            Inst::MemSet(d, s, count)
        });
        Ok(if e.ty.is_void() { None } else { Some(d) })
    }

    /// `va_arg` of a struct or union: the address of the argument, advancing the va_list at
    /// `ap`. Arguments that arrived in registers are reassembled in a temporary.
    fn gen_va_arg_aggregate(&mut self, ap: V, ty: &Type, loc: Loc) -> Res<V> {
        use crate::types::{Arch, Os};
        let target = self.tcx.target;
        let size = self.tcx.size_of(ty).unwrap_or(0);
        let align = self.tcx.align_of(ty).unwrap_or(1);
        if size == 0 {
            return Ok(self.temp_object(ty));
        }
        let classify = |g: &Self| {
            abi::sysv_classify(g.tcx, ty).map_err(|msg| crate::token::Error { loc, msg })
        };
        let windows = target.os == Os::Windows;
        let apple_arm = target.arch == Arch::Aarch64 && target.os == Os::MacOs;
        if windows || apple_arm {
            // `char *`: small aggregates sit in the argument slots, large ones are pointed to.
            classify(self)?;
            let inline = if windows {
                matches!(size, 1 | 2 | 4 | 8)
            } else {
                size <= 16
            };
            let mut cursor = self.b.load(MemKind::I64, ap, 0);
            if inline && align >= 16 {
                let round = self.b.const_i64(15);
                let mask = self.b.const_i64(-16);
                let bumped = self.b.bin(CBin::Add, cursor, round);
                cursor = self.b.bin(CBin::And, bumped, mask);
            }
            let step = if inline { size.next_multiple_of(8) } else { 8 };
            let step = self.b.const_i64(step as i64);
            let next = self.b.bin(CBin::Add, cursor, step);
            self.b.effect(Inst::Store(MemKind::I64, next, ap, 0));
            return Ok(if inline {
                cursor
            } else {
                self.b.load(MemKind::I64, cursor, 0)
            });
        }
        if target.arch == Arch::Aarch64 {
            return self.gen_va_arg_aggregate_aapcs64(ap, ty, loc);
        }

        // x86-64 System V (psABI 3.5.7).
        let pieces = classify(self)?;
        let from_overflow = |g: &mut Self, ap: V| -> V {
            let mut area = g.b.load(MemKind::I64, ap, 8);
            if align > 8 {
                let round = g.b.const_i64(align as i64 - 1);
                let mask = g.b.const_i64(-(align as i64));
                let bumped = g.b.bin(CBin::Add, area, round);
                area = g.b.bin(CBin::And, bumped, mask);
            }
            let step = g.b.const_i64(size.next_multiple_of(8) as i64);
            let next = g.b.bin(CBin::Add, area, step);
            g.b.effect(Inst::Store(MemKind::I64, next, ap, 8));
            area
        };
        let Some(pieces) = pieces else {
            return Ok(from_overflow(self, ap));
        };
        if pieces.iter().any(|p| p.ty == Ty::V128) {
            return err(
                loc,
                "va_arg of a struct that contains a vector is not supported yet",
            );
        }
        let ints = pieces.iter().filter(|p| !p.ty.is_float()).count() as i32;
        let floats = pieces.len() as i32 - ints;
        let list = self.alloc_temp(Ty::I64);
        let result = self.alloc_temp(Ty::I64);
        self.b.effect(Inst::LocalSet(list, ap));
        // Every eightbyte is stored whole, so the temporary is a whole number of them.
        let slot = self.b.add_slot(pieces.len() as u64 * 8, align.max(8));
        let (in_registers, in_memory, done) =
            (self.b.new_block(), self.b.new_block(), self.b.new_block());
        let mut fits: Option<V> = None;
        for (count, field, limit, stride) in [(ints, 0, 48, 8), (floats, 4, 176, 16)] {
            if count == 0 {
                continue;
            }
            let offset = self.b.load(MemKind::I32, ap, field);
            let last = self.b.const_i32(limit - count * stride);
            let ok = self.b.bin(CBin::ULe, offset, last);
            fits = Some(match fits {
                Some(previous) => self.b.bin(CBin::And, previous, ok),
                None => ok,
            });
        }
        let Some(fits) = fits else {
            return internal(loc, "aggregate without eightbytes");
        };
        self.b.terminate(Inst::Br(fits, in_registers, in_memory));

        self.b.switch_to(in_registers);
        let ap = self.b.local_get(list);
        let area = self.b.load(MemKind::I64, ap, 16);
        let object = self.b.def(Inst::SlotAddr(slot), Ty::I64);
        let gp = self.b.load(MemKind::I32, ap, 0);
        let fp = self.b.load(MemKind::I32, ap, 4);
        let gp_base = {
            let wide = self.b.un(UnOp::ZExt32, gp);
            self.b.bin(CBin::Add, area, wide)
        };
        let fp_base = {
            let wide = self.b.un(UnOp::ZExt32, fp);
            self.b.bin(CBin::Add, area, wide)
        };
        let (mut next_int, mut next_float) = (0i64, 0i64);
        for piece in &pieces {
            let bits = if piece.ty.is_float() {
                next_float += 1;
                self.b.load(MemKind::I64, fp_base, (next_float - 1) * 16)
            } else {
                next_int += 1;
                self.b.load(MemKind::I64, gp_base, (next_int - 1) * 8)
            };
            self.b
                .effect(Inst::Store(MemKind::I64, bits, object, piece.offset as i64));
        }
        if ints > 0 {
            let step = self.b.const_i32(ints * 8);
            let advanced = self.b.bin(CBin::Add, gp, step);
            self.b.effect(Inst::Store(MemKind::I32, advanced, ap, 0));
        }
        if floats > 0 {
            let step = self.b.const_i32(floats * 16);
            let advanced = self.b.bin(CBin::Add, fp, step);
            self.b.effect(Inst::Store(MemKind::I32, advanced, ap, 4));
        }
        self.b.effect(Inst::LocalSet(result, object));
        self.b.terminate(Inst::Jump(done));

        self.b.switch_to(in_memory);
        let ap = self.b.local_get(list);
        let address = from_overflow(self, ap);
        self.b.effect(Inst::LocalSet(result, address));
        self.b.terminate(Inst::Jump(done));

        self.b.switch_to(done);
        let address = self.b.local_get(result);
        self.free_temp(list, Ty::I64);
        self.free_temp(result, Ty::I64);
        Ok(address)
    }

    /// AAPCS64 `va_arg` of a composite (appendix B of the procedure call standard).
    fn gen_va_arg_aggregate_aapcs64(&mut self, ap: V, ty: &Type, loc: Loc) -> Res<V> {
        let size = self.tcx.size_of(ty).unwrap_or(0);
        let align = self.tcx.align_of(ty).unwrap_or(1);
        let abi = self
            .m
            .call_abi(&Type::Void, std::slice::from_ref(ty), 1, loc)?;
        let pieces = match abi.args.first() {
            // Passed by reference: the argument is a pointer in a general register or on the stack.
            Some(ArgPass::Reference) => {
                let slot = self.gen_va_arg_address(ap, false);
                return Ok(self.b.load(MemKind::I64, slot, 0));
            }
            Some(ArgPass::Pieces(pieces)) => pieces.clone(),
            _ => return internal(loc, "unexpected AAPCS64 classification"),
        };
        let pieces: Vec<Piece> = pieces.into_iter().filter(|p| p.bytes > 0).collect();
        if pieces.iter().any(|p| p.ty == Ty::V128) {
            return err(
                loc,
                "va_arg of a struct that contains a vector is not supported yet",
            );
        }
        let hfa = pieces.first().is_some_and(|p| p.ty.is_float());
        let (offs_field, top_field, stride) = if hfa { (28, 16, 16i32) } else { (24, 8, 8) };
        let nregs = pieces.len() as i32;
        let list = self.alloc_temp(Ty::I64);
        let result = self.alloc_temp(Ty::I64);
        self.b.effect(Inst::LocalSet(list, ap));
        let (try_registers, in_registers, in_memory, done) = (
            self.b.new_block(),
            self.b.new_block(),
            self.b.new_block(),
            self.b.new_block(),
        );
        let offs = self.b.load(MemKind::I32, ap, offs_field);
        let zero = self.b.const_i32(0);
        let exhausted = self.b.bin(CBin::Ge, offs, zero);
        self.b
            .terminate(Inst::Br(exhausted, in_memory, try_registers));

        self.b.switch_to(try_registers);
        let ap = self.b.local_get(list);
        let mut offs = self.b.load(MemKind::I32, ap, offs_field);
        if !hfa && align >= 16 {
            let round = self.b.const_i32(15);
            let mask = self.b.const_i32(-16);
            let bumped = self.b.bin(CBin::Add, offs, round);
            offs = self.b.bin(CBin::And, bumped, mask);
        }
        let step = self.b.const_i32(nregs * stride);
        let advanced = self.b.bin(CBin::Add, offs, step);
        self.b
            .effect(Inst::Store(MemKind::I32, advanced, ap, offs_field));
        let start = self.alloc_temp(Ty::I32);
        self.b.effect(Inst::LocalSet(start, offs));
        let zero = self.b.const_i32(0);
        let overflowed = self.b.bin(CBin::Gt, advanced, zero);
        self.b
            .terminate(Inst::Br(overflowed, in_memory, in_registers));

        self.b.switch_to(in_registers);
        let ap = self.b.local_get(list);
        let top = self.b.load(MemKind::I64, ap, top_field);
        let offs = self.b.local_get(start);
        let wide = self.b.un(UnOp::SExt32, offs);
        let base = self.b.bin(CBin::Add, top, wide);
        let address = if hfa {
            // Each member sits in its own 16-byte register image; gather them.
            let object = self.temp_object(ty);
            for (i, piece) in pieces.iter().enumerate() {
                let kind = if piece.ty == Ty::F32 {
                    MemKind::F32
                } else {
                    MemKind::F64
                };
                let v = self.b.load(kind, base, i as i64 * 16);
                self.b
                    .effect(Inst::Store(kind, v, object, piece.offset as i64));
            }
            object
        } else {
            base
        };
        self.b.effect(Inst::LocalSet(result, address));
        self.b.terminate(Inst::Jump(done));

        self.b.switch_to(in_memory);
        let ap = self.b.local_get(list);
        let mut address = self.b.load(MemKind::I64, ap, 0);
        if align > 8 {
            let round = self.b.const_i64(align as i64 - 1);
            let mask = self.b.const_i64(-(align as i64));
            let bumped = self.b.bin(CBin::Add, address, round);
            address = self.b.bin(CBin::And, bumped, mask);
        }
        let step = self.b.const_i64(size.next_multiple_of(8) as i64);
        let next = self.b.bin(CBin::Add, address, step);
        self.b.effect(Inst::Store(MemKind::I64, next, ap, 0));
        self.b.effect(Inst::LocalSet(result, address));
        self.b.terminate(Inst::Jump(done));

        self.b.switch_to(done);
        let address = self.b.local_get(result);
        self.free_temp(list, Ty::I64);
        self.free_temp(result, Ty::I64);
        self.free_temp(start, Ty::I32);
        Ok(address)
    }

    /// `va_arg`: the address of the next variable argument of class `float`, advancing the
    /// va_list at `ap`. Each target's layout is the one `VaStart` fills in (see BIR.h).
    fn gen_va_arg_address(&mut self, ap: V, float: bool) -> V {
        use crate::types::{Arch, Os};
        let target = self.tcx.target;
        let pointer_list =
            target.os == Os::Windows || (target.arch == Arch::Aarch64 && target.os == Os::MacOs);
        if pointer_list {
            // `char *`: every argument occupies one 8-byte slot.
            let cursor = self.b.load(MemKind::I64, ap, 0);
            let eight = self.b.const_i64(8);
            let next = self.b.bin(CBin::Add, cursor, eight);
            self.b.effect(Inst::Store(MemKind::I64, next, ap, 0));
            return cursor;
        }
        // The list address and the result cross blocks, so they live in locals.
        let list = self.alloc_temp(Ty::I64);
        let result = self.alloc_temp(Ty::I64);
        self.b.effect(Inst::LocalSet(list, ap));
        let (in_registers, in_memory, done) =
            (self.b.new_block(), self.b.new_block(), self.b.new_block());
        if target.arch == Arch::X86_64 {
            // System V: { u32 gp_offset; u32 fp_offset; void *overflow_arg_area; void *reg_save_area; }
            let (field, limit, stride) = if float { (4, 176, 16) } else { (0, 48, 8) };
            let offset = self.b.load(MemKind::I32, ap, field);
            let limit = self.b.const_i32(limit);
            let fits = self.b.bin(CBin::ULt, offset, limit);
            self.b.terminate(Inst::Br(fits, in_registers, in_memory));

            self.b.switch_to(in_registers);
            let ap = self.b.local_get(list);
            let offset = self.b.load(MemKind::I32, ap, field);
            let area = self.b.load(MemKind::I64, ap, 16);
            let wide_offset = self.b.un(UnOp::ZExt32, offset);
            let address = self.b.bin(CBin::Add, area, wide_offset);
            let stride = self.b.const_i32(stride);
            let advanced = self.b.bin(CBin::Add, offset, stride);
            self.b
                .effect(Inst::Store(MemKind::I32, advanced, ap, field));
            self.b.effect(Inst::LocalSet(result, address));
            self.b.terminate(Inst::Jump(done));

            self.b.switch_to(in_memory);
            let ap = self.b.local_get(list);
            let address = self.b.load(MemKind::I64, ap, 8);
            let eight = self.b.const_i64(8);
            let advanced = self.b.bin(CBin::Add, address, eight);
            self.b.effect(Inst::Store(MemKind::I64, advanced, ap, 8));
            self.b.effect(Inst::LocalSet(result, address));
            self.b.terminate(Inst::Jump(done));
        } else {
            // AAPCS64: { void *stack; void *gr_top; void *vr_top; int gr_offs; int vr_offs; }
            let (offs_field, top_field, stride) = if float { (28, 16, 16) } else { (24, 8, 8) };
            let try_registers = self.b.new_block();
            let offs = self.b.load(MemKind::I32, ap, offs_field);
            let zero = self.b.const_i32(0);
            let exhausted = self.b.bin(CBin::Ge, offs, zero);
            self.b
                .terminate(Inst::Br(exhausted, in_memory, try_registers));

            self.b.switch_to(try_registers);
            let ap = self.b.local_get(list);
            let offs = self.b.load(MemKind::I32, ap, offs_field);
            let stride = self.b.const_i32(stride);
            let advanced = self.b.bin(CBin::Add, offs, stride);
            self.b
                .effect(Inst::Store(MemKind::I32, advanced, ap, offs_field));
            let zero = self.b.const_i32(0);
            let overflowed = self.b.bin(CBin::Gt, advanced, zero);
            self.b
                .terminate(Inst::Br(overflowed, in_memory, in_registers));

            self.b.switch_to(in_registers);
            let ap = self.b.local_get(list);
            // The store above already advanced the offset; the argument is at top + old offset.
            let advanced = self.b.load(MemKind::I32, ap, offs_field);
            let stride = self.b.const_i32(stride_of(float));
            let offs = self.b.bin(CBin::Sub, advanced, stride);
            let top = self.b.load(MemKind::I64, ap, top_field);
            let wide_offs = self.b.un(UnOp::SExt32, offs);
            let address = self.b.bin(CBin::Add, top, wide_offs);
            self.b.effect(Inst::LocalSet(result, address));
            self.b.terminate(Inst::Jump(done));

            self.b.switch_to(in_memory);
            let ap = self.b.local_get(list);
            let address = self.b.load(MemKind::I64, ap, 0);
            let eight = self.b.const_i64(8);
            let advanced = self.b.bin(CBin::Add, address, eight);
            self.b.effect(Inst::Store(MemKind::I64, advanced, ap, 0));
            self.b.effect(Inst::LocalSet(result, address));
            self.b.terminate(Inst::Jump(done));
        }
        self.b.switch_to(done);
        let address = self.b.local_get(result);
        self.free_temp(list, Ty::I64);
        self.free_temp(result, Ty::I64);
        address
    }

    fn gen_stmt(&mut self, stmt: &Stmt, loc: Loc) -> Res<()> {
        match stmt {
            Stmt::Empty => Ok(()),
            Stmt::Expr(e) => self.gen_discard(e),
            Stmt::LocalInit {
                local,
                zero_first,
                items,
            } => self.gen_local_init(*local, *zero_first, items, loc),
            Stmt::Block(stmts) => self.gen_stmts(stmts, loc),
            Stmt::If(cond, then, otherwise) => {
                let (then_block, end) = (self.b.new_block(), self.b.new_block());
                let else_block = if otherwise.is_some() {
                    self.b.new_block()
                } else {
                    end
                };
                self.gen_cond(cond, then_block, else_block)?;
                self.b.switch_to(then_block);
                self.gen_stmt(then, loc)?;
                self.b.terminate(Inst::Jump(end));
                if let Some(otherwise) = otherwise {
                    self.b.switch_to(else_block);
                    self.gen_stmt(otherwise, loc)?;
                    self.b.terminate(Inst::Jump(end));
                }
                self.b.switch_to(end);
                Ok(())
            }
            Stmt::While(cond, body) => {
                let (head, body_block, end) =
                    (self.b.new_block(), self.b.new_block(), self.b.new_block());
                self.b.terminate(Inst::Jump(head));
                self.b.switch_to(head);
                self.gen_cond(cond, body_block, end)?;
                self.b.switch_to(body_block);
                self.gen_loop_body(body, end, head, loc)?;
                self.b.terminate(Inst::Jump(head));
                self.b.switch_to(end);
                Ok(())
            }
            Stmt::DoWhile(body, cond) => {
                let (body_block, check, end) =
                    (self.b.new_block(), self.b.new_block(), self.b.new_block());
                self.b.terminate(Inst::Jump(body_block));
                self.b.switch_to(body_block);
                self.gen_loop_body(body, end, check, loc)?;
                self.b.terminate(Inst::Jump(check));
                self.b.switch_to(check);
                self.gen_cond(cond, body_block, end)?;
                self.b.switch_to(end);
                Ok(())
            }
            Stmt::For {
                init,
                cond,
                step,
                body,
            } => {
                if let Some(init) = init {
                    self.gen_stmt(init, loc)?;
                }
                let (head, body_block, step_block, end) = (
                    self.b.new_block(),
                    self.b.new_block(),
                    self.b.new_block(),
                    self.b.new_block(),
                );
                self.b.terminate(Inst::Jump(head));
                self.b.switch_to(head);
                match cond {
                    Some(cond) => self.gen_cond(cond, body_block, end)?,
                    None => self.b.terminate(Inst::Jump(body_block)),
                }
                self.b.switch_to(body_block);
                self.gen_loop_body(body, end, step_block, loc)?;
                self.b.terminate(Inst::Jump(step_block));
                self.b.switch_to(step_block);
                if let Some(step) = step {
                    self.gen_discard(step)?;
                }
                self.b.terminate(Inst::Jump(head));
                self.b.switch_to(end);
                Ok(())
            }
            Stmt::Switch {
                cond,
                body,
                cases,
                default,
            } => {
                let v = self.gen_value(cond)?;
                let narrow = self.b.value_ty(v) == Ty::I32;
                let end = self.b.new_block();
                let default_block = match default {
                    Some(label) => self.label_block(*label),
                    None => end,
                };
                // For an i32 scrutinee a case is the sign-extended 32-bit pattern.
                let pattern = |value: i64| {
                    if narrow {
                        i64::from(value as i32)
                    } else {
                        value
                    }
                };
                let span = |case: &SwitchCase| -> u64 {
                    let width = pattern(case.high).wrapping_sub(pattern(case.value)) as u64;
                    if narrow { width & 0xffff_ffff } else { width }
                };
                // Wide GNU case ranges are tested one by one ahead of the jump table.
                let mut v = v;
                let wide_ranges: Vec<&SwitchCase> = cases.iter().filter(|c| span(c) > 64).collect();
                if !wide_ranges.is_empty() {
                    let mty = self.b.value_ty(v);
                    let temp = self.alloc_temp(mty);
                    self.b.effect(Inst::LocalSet(temp, v));
                    for case in wide_ranges {
                        let x = self.b.local_get(temp);
                        let low = self.b.const_int(mty, pattern(case.value));
                        let delta = self.b.bin(CBin::Sub, x, low);
                        let width = self.b.const_int(mty, span(case) as i64);
                        let inside = self.b.bin(CBin::ULe, delta, width);
                        let next = self.b.new_block();
                        let target = self.label_block(case.label);
                        self.b.terminate(Inst::Br(inside, target, next));
                        self.b.switch_to(next);
                    }
                    v = self.b.local_get(temp);
                    self.free_temp(temp, mty);
                }
                let mut table = Vec::with_capacity(cases.len());
                for case in cases.iter().filter(|c| span(c) <= 64) {
                    let block = self.label_block(case.label);
                    for step in 0..=span(case) {
                        table.push((
                            pattern(pattern(case.value).wrapping_add(step as i64)),
                            block,
                        ));
                    }
                }
                self.b.terminate(Inst::Switch(v, default_block, table));
                self.break_stack.push((end, self.vla_stack.len()));
                self.gen_stmt(body, loc)?;
                self.break_stack.pop();
                self.b.terminate(Inst::Jump(end));
                self.b.switch_to(end);
                Ok(())
            }
            Stmt::Label(label, body) => {
                let block = self.label_block(*label);
                self.b.terminate(Inst::Jump(block));
                self.b.switch_to(block);
                self.gen_stmt(body, loc)
            }
            Stmt::Goto(label) => {
                // The parser checked that the target's scopes are a prefix of ours.
                let depth = self
                    .body
                    .label_vla_paths
                    .get(*label as usize)
                    .map_or(0, Vec::len);
                self.leave_vla_scopes(depth)?;
                let block = self.label_block(*label);
                self.b.terminate(Inst::Jump(block));
                Ok(())
            }
            Stmt::GotoComputed(target) => {
                let v = self.gen_value(target)?;
                let labels = self.body.address_labels.clone();
                let table = labels
                    .iter()
                    .enumerate()
                    .map(|(i, &label)| (i as i64 + 1, self.label_block(label)))
                    .collect();
                let nowhere = self.b.new_block();
                self.b.terminate(Inst::Switch(v, nowhere, table));
                self.b.switch_to(nowhere);
                self.b.terminate(Inst::Unreachable);
                Ok(())
            }
            Stmt::VlaAlloc { local, size, align } => {
                let bytes = self.gen_value(size)?;
                let address = self.b.def(Inst::StackAlloc(bytes, *align), Ty::I64);
                let LocalPlace::Dynamic(reg) = self.locals[*local as usize] else {
                    return internal(loc, "variable length array without a pointer variable");
                };
                self.b.effect(Inst::LocalSet(reg, address));
                Ok(())
            }
            Stmt::VlaScope { id, cleanup, body } => {
                let saved = if cleanup.is_none() {
                    let saved = self.alloc_temp(Ty::I64);
                    let sp = self.b.def(Inst::StackSave, Ty::I64);
                    self.b.effect(Inst::LocalSet(saved, sp));
                    Some(saved)
                } else {
                    None
                };
                self.vla_stack
                    .push((*id, saved, cleanup.as_deref().cloned()));
                self.gen_stmts(body, loc)?;
                // Falling off the end leaves the scope like any other way out.
                let depth = self.vla_stack.len() - 1;
                self.leave_vla_scopes(depth)?;
                self.vla_stack.pop();
                if let Some(saved) = saved {
                    self.free_temp(saved, Ty::I64);
                }
                Ok(())
            }
            Stmt::Break => match self.break_stack.last() {
                Some(&(block, depth)) => {
                    self.leave_vla_scopes(depth)?;
                    self.b.terminate(Inst::Jump(block));
                    Ok(())
                }
                None => internal(loc, "break outside of a loop or switch"),
            },
            Stmt::Continue => match self.continue_stack.last() {
                Some(&(block, depth)) => {
                    self.leave_vla_scopes(depth)?;
                    self.b.terminate(Inst::Jump(block));
                    Ok(())
                }
                None => internal(loc, "continue outside of a loop"),
            },
            Stmt::Return(value) => {
                // The value is computed first; then the cleanups of every open scope run.
                let has_cleanups = self.vla_stack.iter().any(|(_, _, c)| c.is_some());
                match value {
                    // A 128-bit result leaves as its two halves.
                    Some(e)
                        if !has_cleanups
                            && e.ty.is_int128()
                            && matches!(&self.ret_pass, RetPass::Pieces(p) if p.len() == 2 && p.iter().all(|p| p.ty == Ty::I64)) =>
                    {
                        let wide = self.gen_wide_any(e)?;
                        let high = self.high_value(wide);
                        self.b.terminate(Inst::Ret(vec![wide.low, high]));
                    }
                    Some(e) => {
                        let v = self.gen_value(e)?;
                        if has_cleanups {
                            // A cleanup may change the variable the value was read from.
                            let v = if e.ty.is_value() {
                                v
                            } else {
                                let copy = self.temp_object(&e.ty);
                                let n = self.tcx.size_of(&e.ty).unwrap_or(0);
                                let n = self.b.const_i64(n as i64);
                                self.b.effect(Inst::MemCopy(copy, v, n));
                                copy
                            };
                            let held = self.hold(v, true);
                            self.run_cleanups()?;
                            let v = self.release(held);
                            self.gen_return(v);
                        } else {
                            self.gen_return(v);
                        }
                    }
                    None => {
                        if has_cleanups {
                            self.run_cleanups()?;
                        }
                        self.gen_default_return();
                    }
                }
                Ok(())
            }
        }
    }

    /// Leaves every open `VlaScope` beyond the first `keep`: runs their cleanups, innermost
    /// first, then releases their variable length arrays.
    fn leave_vla_scopes(&mut self, keep: usize) -> Res<()> {
        if self.b.is_terminated() {
            return Ok(());
        }
        let leaving: Vec<(Option<u32>, Option<Expr>)> = self
            .vla_stack
            .iter()
            .skip(keep)
            .map(|(_, saved, cleanup)| (*saved, cleanup.clone()))
            .collect();
        for (_, cleanup) in leaving.iter().rev() {
            if let Some(call) = cleanup {
                self.gen_expr(call)?;
            }
        }
        // The outermost saved stack pointer releases everything allocated since.
        if let Some(saved) = leaving.iter().find_map(|(saved, _)| *saved) {
            let sp = self.b.local_get(saved);
            self.b.effect(Inst::StackRestore(sp));
        }
        Ok(())
    }

    fn gen_loop_body(
        &mut self,
        body: &Stmt,
        break_block: u32,
        continue_block: u32,
        loc: Loc,
    ) -> Res<()> {
        self.break_stack.push((break_block, self.vla_stack.len()));
        self.continue_stack
            .push((continue_block, self.vla_stack.len()));
        let result = self.gen_stmt(body, loc);
        self.break_stack.pop();
        self.continue_stack.pop();
        result
    }

    /// `return;`, or falling off the end: a non-void function returns zero.
    /// The cleanups of every open scope, innermost first: what `return` runs.
    fn run_cleanups(&mut self) -> Res<()> {
        if self.b.is_terminated() {
            return Ok(());
        }
        let calls: Vec<Expr> = self
            .vla_stack
            .iter()
            .filter_map(|(_, _, c)| c.clone())
            .collect();
        for call in calls.iter().rev() {
            self.gen_expr(call)?;
        }
        Ok(())
    }

    fn gen_default_return(&mut self) {
        if self.b.is_terminated() {
            return;
        }
        match self.ret_pass.clone() {
            RetPass::Void | RetPass::Indirect => self.b.terminate(Inst::RetVoid),
            RetPass::Scalar(ty) => {
                let zero = self.zero(ty);
                self.b.terminate(Inst::Ret(vec![zero]));
            }
            RetPass::Pieces(pieces) => {
                let zeros = pieces.iter().map(|p| self.zero(p.ty)).collect();
                self.b.terminate(Inst::Ret(zeros));
            }
            RetPass::HiddenPointer => self.b.terminate(Inst::Ret(vec![0])),
            // The caller takes something off the x87 stack whatever happens.
            RetPass::X87 => {
                let zero = self.long_double_constant(crate::extended::Extended::ZERO);
                self.gen_return(zero);
            }
        }
    }

    /// `return` of `v`: a scalar value, or the address of the aggregate to return.
    fn gen_return(&mut self, v: V) {
        match self.ret_pass.clone() {
            RetPass::Scalar(_) => self.b.terminate(Inst::Ret(vec![v])),
            RetPass::Pieces(pieces) => {
                let values = pieces.iter().map(|p| self.load_piece(v, p)).collect();
                self.b.terminate(Inst::Ret(values));
            }
            // The result address is parameter 0 in both conventions.
            RetPass::HiddenPointer | RetPass::Indirect => {
                let n = self
                    .b
                    .const_i64(self.tcx.size_of(&self.ret).unwrap_or(0) as i64);
                self.b.effect(Inst::MemCopy(0, v, n));
                if self.ret_pass == RetPass::HiddenPointer {
                    self.b.terminate(Inst::Ret(vec![0]));
                } else {
                    self.b.terminate(Inst::RetVoid);
                }
            }
            RetPass::Void => self.b.terminate(Inst::RetVoid),
            // Nothing may come between putting the value on the x87 stack and returning.
            RetPass::X87 => {
                self.x87(crate::x87::X87Op::LoadReturn, vec![v]);
                self.b.terminate(Inst::RetVoid);
            }
        }
    }
}

/// The bun:ffi `FFIType` of a scalar C type.
fn ffi_type(ty: &Type, tcx: &TypeCtx) -> u8 {
    let long_is_64 = tcx.target.long_size() == 8;
    match ty {
        Type::Char => 0,
        Type::SChar => 1,
        Type::UChar => 2,
        Type::Short => 3,
        Type::UShort => 4,
        Type::Int => 5,
        Type::UInt => 6,
        Type::Long => {
            if long_is_64 {
                7
            } else {
                5
            }
        }
        Type::ULong => {
            if long_is_64 {
                8
            } else {
                6
            }
        }
        Type::LLong => 7,
        Type::ULLong => 8,
        Type::Double => 9,
        Type::Float => 10,
        Type::Bool => 11,
        Type::Void => 13,
        _ => 12,
    }
}

fn gen_function<'a>(m: &mut ModuleGen<'a>, f: &'a Function, body: &'a FuncBody) -> Res<bir::Func> {
    let tcx = m.tcx;
    if let Some(Type::Wide(kind)) = std::iter::once(&f.ty.ret)
        .chain(&f.ty.params)
        .find(|t| matches!(t, Type::Wide(_)) && !t.is_long_double())
    {
        return err(
            f.loc,
            format!(
                "'{}': taking or returning a value of type '{}' is not supported yet",
                f.name,
                kind.name()
            ),
        );
    }
    let abi = m.call_abi(&f.ty.ret, &f.ty.params, f.ty.params.len(), f.loc)?;
    let param_types: Vec<Ty> = abi.named_params.iter().map(|p| p.value_ty()).collect();
    let sig = m.sig_for(&f.ty, f.loc)?;
    let mut g = FnGen {
        m,
        tcx,
        b: FuncBuilder::new(&param_types),
        locals: Vec::with_capacity(body.locals.len()),
        scalar_sets: Vec::new(),
        local_types: &body.locals,
        labels: vec![None; body.nlabels as usize],
        break_stack: Vec::new(),
        continue_stack: Vec::new(),
        vla_stack: Vec::new(),
        body,
        free_temps: Default::default(),
        ret: f.ty.ret.clone(),
        ret_pass: abi.ret.clone(),
        result_unused: false,
        want_wide_result: false,
        wide_result: None,
        wide_arguments: Vec::new(),
    };
    // The machine parameters each C parameter arrives in, after a leading result pointer.
    let mut next_value: V = match abi.ret {
        RetPass::HiddenPointer | RetPass::Indirect => 1,
        _ => 0,
    };
    let mut arrival: Vec<Option<(V, &ArgPass)>> = vec![None; body.locals.len()];
    for (&local, pass) in body.params.iter().zip(&abi.args) {
        arrival[local as usize] = Some((next_value, pass));
        next_value += match pass {
            ArgPass::Scalar(_) | ArgPass::Stack { .. } | ArgPass::Reference => 1,
            ArgPass::Pieces(pieces) => pieces.len() as V,
            ArgPass::Ignore => 0,
        };
    }
    // A function that calls setjmp can be re-entered in the middle by longjmp: every
    // variable then has to be in memory, as if it were volatile.
    let returns_twice = calls_returns_twice(g.m.prog, body);
    let replaced = if returns_twice || !g.m.prog.replace_aggregates {
        Vec::new()
    } else {
        sroa::promotable_locals(body, tcx)
    };
    for (index, local) in body.locals.iter().enumerate() {
        if let Some(Some(elements)) = replaced.get(index) {
            let leaves = elements
                .iter()
                .map(|(offset, ty)| sroa::Leaf {
                    offset: *offset,
                    ty: ty.clone(),
                    reg: g.b.add_local(tcx.machine_ty(ty)),
                })
                .collect();
            g.scalar_sets.push(leaves);
            g.locals
                .push(LocalPlace::Scalars(g.scalar_sets.len() as u32 - 1));
            g.m.replaced_aggregates += 1;
            continue;
        }
        let by_address = matches!(
            arrival[index],
            Some((_, ArgPass::Stack { .. } | ArgPass::Reference))
        );
        let place = if let (true, Some((value, _))) = (by_address, arrival[index]) {
            // The callee owns the copy it was handed: that is the variable.
            LocalPlace::Addr(value)
        } else if tcx.is_variably_sized(&local.ty) {
            LocalPlace::Dynamic(g.b.add_local(Ty::I64))
        } else if local.ty.is_value()
            && (!local.addr_taken || local.only_punned())
            && !local.volatile
            && !returns_twice
        {
            LocalPlace::Reg(g.b.add_local(tcx.machine_ty(&local.ty)))
        } else if local.ty.unqualified().is_int128()
            && !local.addr_taken
            && !local.volatile
            && !returns_twice
            && match &arrival[index] {
                None => true,
                // A parameter that arrives as its two halves.
                Some((_, ArgPass::Pieces(pieces))) => {
                    pieces.len() == 2 && pieces.iter().all(|p| p.ty == Ty::I64)
                }
                Some(_) => false,
            }
        {
            LocalPlace::Halves(g.b.add_local(Ty::I64), g.b.add_local(Ty::I64))
        } else {
            let size = tcx.size_of(&local.ty).unwrap_or(0).max(1);
            let align = tcx
                .align_of(&local.ty)
                .unwrap_or(1)
                .max(local.align.unwrap_or(1));
            LocalPlace::Slot(g.b.add_slot(size, align))
        };
        g.locals.push(place);
    }
    for (&local, param_ty) in body.params.iter().zip(&f.ty.params) {
        let ty = &body.locals[local as usize].ty;
        let Some((first, pass)) = arrival[local as usize] else {
            continue;
        };
        match pass {
            ArgPass::Scalar(_) => {
                // Native callers leave the bits above a narrow argument unspecified, so normalise on entry.
                let v = if tcx.is_narrow(param_ty) {
                    g.normalize_native(first, param_ty)
                } else {
                    first
                };
                // An old-style definition receives promoted arguments and narrows them.
                let v = if param_ty != ty.unatomic() && param_ty.is_value() {
                    g.convert(v, param_ty, ty, f.loc)?
                } else {
                    v
                };
                match g.locals[local as usize] {
                    LocalPlace::Reg(reg) => g.b.effect(Inst::LocalSet(reg, v)),
                    LocalPlace::Slot(slot) => {
                        let base = g.b.def(Inst::SlotAddr(slot), Ty::I64);
                        g.b.effect(Inst::Store(tcx.mem_kind(ty, true), v, base, 0));
                    }
                    LocalPlace::Addr(_)
                    | LocalPlace::Dynamic(_)
                    | LocalPlace::Halves(..)
                    | LocalPlace::Scalars(_) => {}
                }
            }
            ArgPass::Pieces(pieces) => {
                if let LocalPlace::Slot(slot) = g.locals[local as usize] {
                    let base = g.b.def(Inst::SlotAddr(slot), Ty::I64);
                    for (k, piece) in pieces.iter().enumerate() {
                        g.store_piece(first + k as V, base, piece);
                    }
                } else if let LocalPlace::Halves(low, high) = g.locals[local as usize] {
                    g.b.effect(Inst::LocalSet(low, first));
                    g.b.effect(Inst::LocalSet(high, first + 1));
                }
            }
            ArgPass::Stack { .. } | ArgPass::Reference | ArgPass::Ignore => {}
        }
    }
    g.gen_stmts(&body.stmts, f.loc)?;
    g.gen_default_return();
    // A definition is known to the loader and the linker by its assembler name, if it has one.
    let symbol = f.link_name.as_ref().unwrap_or(&f.name).to_string();
    let mut func = g.b.finish(symbol, sig, is_exported(f));
    func.returns_twice = returns_twice;
    // Code that must see its own frame or come back from setjmp stays where it is.
    let inlining = f.inlining & (bir::INLINE_ALWAYS | bir::INLINE_NEVER | bir::INLINE_HINT);
    func.inlining = if returns_twice {
        inlining & !bir::INLINE_ALWAYS
    } else {
        inlining
    };
    Ok(func)
}

/// Whether the body calls a function that can return a second time (`setjmp` and the names
/// the C libraries' headers expand it to).
fn calls_returns_twice(prog: &Program, body: &FuncBody) -> bool {
    let mut called = Vec::new();
    for stmt in &body.stmts {
        functions_in_stmt(stmt, &mut called);
    }
    called.iter().any(|&id| {
        matches!(
            &*prog.funcs[id as usize].name,
            "setjmp"
                | "_setjmp"
                | "__setjmp"
                | "sigsetjmp"
                | "__sigsetjmp"
                | "_setjmpex"
                | "savectx"
                | "vfork"
                | "getcontext"
        )
    })
}

/// Whether a defined function is visible outside the module.
/// For every local of `body`: whether it is an array or structure that code generation
/// would replace by its elements (see `sroa`).
pub(crate) fn replaceable_aggregates(body: &FuncBody, tcx: &TypeCtx) -> Vec<bool> {
    sroa::promotable_locals(body, tcx)
        .iter()
        .map(Option::is_some)
        .collect()
}

fn is_exported(f: &Function) -> bool {
    !f.is_static && f.external
}

fn functions_in_expr(e: &Expr, out: &mut Vec<FuncId>) {
    if let ExprKind::Func(id) = e.kind {
        out.push(id);
    }
    if let ExprKind::StmtExpr { stmts, .. } = &e.kind {
        for s in stmts {
            functions_in_stmt(s, out);
        }
    }
    e.for_each_child(|c| functions_in_expr(c, out));
}

fn functions_in_stmt(stmt: &Stmt, out: &mut Vec<FuncId>) {
    match stmt {
        Stmt::Empty | Stmt::Goto(_) | Stmt::Break | Stmt::Continue | Stmt::Return(None) => {}
        Stmt::GotoComputed(e) | Stmt::VlaAlloc { size: e, .. } => functions_in_expr(e, out),
        Stmt::VlaScope { body, cleanup, .. } => {
            if let Some(call) = cleanup {
                functions_in_expr(call, out);
            }
            body.iter().for_each(|s| functions_in_stmt(s, out));
        }
        Stmt::Expr(e) | Stmt::Return(Some(e)) => functions_in_expr(e, out),
        Stmt::LocalInit { items, .. } => {
            for item in items {
                match item {
                    InitItem::Scalar { expr, .. }
                    | InitItem::Copy { expr, .. }
                    | InitItem::Bits { expr, .. } => {
                        functions_in_expr(expr, out);
                    }
                    InitItem::Bytes { .. } => {}
                }
            }
        }
        Stmt::Block(stmts) => stmts.iter().for_each(|s| functions_in_stmt(s, out)),
        Stmt::If(c, t, e) => {
            functions_in_expr(c, out);
            functions_in_stmt(t, out);
            if let Some(e) = e {
                functions_in_stmt(e, out);
            }
        }
        Stmt::While(c, b) | Stmt::DoWhile(b, c) => {
            functions_in_expr(c, out);
            functions_in_stmt(b, out);
        }
        Stmt::For {
            init,
            cond,
            step,
            body,
        } => {
            if let Some(init) = init {
                functions_in_stmt(init, out);
            }
            for e in [cond, step].into_iter().flatten() {
                functions_in_expr(e, out);
            }
            functions_in_stmt(body, out);
        }
        Stmt::Switch { cond, body, .. } => {
            functions_in_expr(cond, out);
            functions_in_stmt(body, out);
        }
        Stmt::Label(_, body) => functions_in_stmt(body, out),
    }
}

/// Marks the defined functions that can run: those reachable from an exported function or
/// whose address is stored in data.
fn reachable_functions(prog: &Program) -> Vec<bool> {
    let mut reachable = vec![false; prog.funcs.len()];
    let mut work: Vec<FuncId> = Vec::new();
    for (i, f) in prog.funcs.iter().enumerate() {
        let runs_by_itself = f.constructor.is_some() || f.destructor.is_some();
        if f.body.is_some() && (is_exported(f) || runs_by_itself) {
            work.push(i as FuncId);
        }
    }
    for g in &prog.globals {
        for r in &g.relocs {
            if let RelocTarget::Func(id) = r.target {
                work.push(id);
            }
        }
    }
    // A function with a second external name is visible under it.
    for &(_, id) in &prog.function_aliases {
        if prog.funcs[id as usize].body.is_some() {
            work.push(id);
        }
    }
    let same = same_functions(prog);
    while let Some(id) = work.pop() {
        if std::mem::replace(&mut reachable[id as usize], true) {
            continue;
        }
        if let Some(target) = same[id as usize] {
            work.push(target);
        }
        if let Some(body) = &prog.funcs[id as usize].body {
            for stmt in &body.stmts {
                functions_in_stmt(stmt, &mut work);
            }
        }
    }
    reachable
}

/// A use of a thread-local object this unit declares `extern` and does not define.
pub(crate) struct TlsExtern {
    /// The `Data` extern that stands for it until the linker finds the definition.
    pub(crate) index: u32,
    pub(crate) name: String,
    /// Where it is first used.
    pub(crate) loc: Loc,
}

/// A compiled translation unit: the module and what the linker needs to know about its
/// data and tls segments, which the serialized form does not carry.
pub(crate) struct Unit {
    pub(crate) module: bir::Module,
    /// How many local arrays and structures became BIR locals, element by element.
    pub(crate) replaced_aggregates: usize,
    /// How many byte-by-byte integer reads and writes became one load or store.
    pub(crate) combined_accesses: (usize, usize),
    pub(crate) objects: Vec<crate::link::DataObject>,
    pub(crate) tls_objects: Vec<crate::link::DataObject>,
    pub(crate) tls_externs: Vec<TlsExtern>,
    /// (priority, function) for every constructor and destructor, in source order. The
    /// module's own tables are these sorted; the linker sorts across units.
    pub(crate) constructors: Vec<(u32, u32)>,
    pub(crate) destructors: Vec<(u32, u32)>,
    /// Other names the linker resolves to functions of this unit: (name, function).
    pub(crate) function_aliases: Vec<(String, u32)>,
    /// The externs that are the calls 128-bit division turns into (`__udivti3`, ...). They
    /// stay imports of the linked module even when a unit defines a function of that name:
    /// such a function is itself written with the division that needs the call.
    pub(crate) runtime_externs: Vec<u32>,
}

/// The order constructors run in: ascending priority, source order within one. Destructors
/// run in the reverse of the order built the same way.
pub(crate) fn initializer_order(entries: &[(u32, u32)], reverse: bool) -> Vec<u32> {
    let mut sorted = entries.to_vec();
    sorted.sort_by_key(|&(priority, _)| priority);
    if reverse {
        sorted.reverse();
    }
    sorted.into_iter().map(|(_, func)| func).collect()
}

pub(crate) fn generate(prog: &Program) -> Res<Unit> {
    let tcx = &prog.tcx;
    let mut m = ModuleGen {
        prog,
        tcx,
        sigs: Vec::new(),
        sig_ids: BTreeMap::new(),
        externs: Vec::new(),
        func_index: vec![None; prog.funcs.len()],
        extern_index: vec![None; prog.funcs.len()],
        data_extern_index: vec![None; prog.globals.len()],
        runtime_externs: BTreeMap::new(),
        replaced_aggregates: 0,
        combined_loads: 0,
        combined_stores: 0,
        tls_externs: Vec::new(),
        blobs: Vec::new(),
        blob_ids: BTreeMap::new(),
        same_object: same_objects(prog),
    };
    // Only functions reachable from an exported function or from initialized data are
    // emitted, so unused `static inline` helpers from headers cost nothing.
    let reachable = reachable_functions(prog);
    let mut next = 0u32;
    for (i, f) in prog.funcs.iter().enumerate() {
        if f.body.is_some() && reachable[i] {
            m.func_index[i] = Some(next);
            next += 1;
        }
    }

    // A declaration under the assembler name of a function defined here is that function.
    for (i, same) in same_functions(prog).into_iter().enumerate() {
        if let Some(target) = same {
            m.func_index[i] = m.func_index[target as usize];
        }
    }

    let mut funcs = Vec::with_capacity(next as usize);
    let mut exports = Vec::new();
    let mut constructors = Vec::new();
    let mut destructors = Vec::new();
    for (i, f) in prog.funcs.iter().enumerate() {
        let Some(body) = &f.body else { continue };
        if !reachable[i] {
            continue;
        }
        let func = gen_function(&mut m, f, body)?;
        if let Some(priority) = f.constructor {
            constructors.push((priority, funcs.len() as u32));
        }
        if let Some(priority) = f.destructor {
            destructors.push((priority, funcs.len() as u32));
        }
        // JS cannot call a variadic function through bun:ffi, so it gets no export entry.
        let plain =
            |ty: &Type| !ty.is_struct() && !ty.is_vector() && !ty.is_pair() && !ty.is_long_double();
        let scalar_only = plain(&f.ty.ret) && f.ty.params.iter().all(plain);
        if is_exported(f) && !f.ty.variadic && scalar_only {
            exports.push(bir::Export {
                name: func.name.clone(),
                func: funcs.len() as u32,
                ret: ffi_type(&f.ty.ret, tcx),
                args: f.ty.params.iter().map(|p| ffi_type(p, tcx)).collect(),
            });
        }
        funcs.push(func);
    }
    // `alias("target")`: the same function under another name, for bun:ffi and the linker.
    let mut function_aliases = Vec::new();
    for (name, id) in &prog.function_aliases {
        let (Some(index), f) = (m.func_index[*id as usize], &prog.funcs[*id as usize]) else {
            continue;
        };
        function_aliases.push((name.to_string(), index));
        funcs[index as usize].exported = true;
        let plain =
            |ty: &Type| !ty.is_struct() && !ty.is_vector() && !ty.is_pair() && !ty.is_long_double();
        if !f.ty.variadic && plain(&f.ty.ret) && f.ty.params.iter().all(plain) {
            exports.push(bir::Export {
                name: name.to_string(),
                func: index,
                ret: ffi_type(&f.ty.ret, tcx),
                args: f.ty.params.iter().map(|p| ffi_type(p, tcx)).collect(),
            });
        }
    }

    // Resolve relocation targets first: they can pull in more blobs and externs.
    struct PendingReloc {
        object: u64,
        offset: u64,
        kind: bir::RelocKind,
        /// Data: object id; Func/Extern: table index.
        target: u64,
        addend: i64,
    }
    let mut pending = Vec::new();
    for (gi, g) in prog.globals.iter().enumerate() {
        for r in &g.relocs {
            let target = match &r.target {
                RelocTarget::Global(id) => RelocTarget::Global(m.same_object[*id as usize]),
                other => other.clone(),
            };
            let (kind, target) = match &target {
                RelocTarget::Global(id) if !prog.globals[*id as usize].defined => {
                    if prog.globals[*id as usize].thread_local {
                        return err(
                            Loc::default(),
                            format!(
                                "'{}' is initialized with the address of a thread-local object that another translation unit defines",
                                g.name
                            ),
                        );
                    }
                    (bir::RelocKind::Extern, u64::from(m.data_extern_for(*id)))
                }
                RelocTarget::Global(id) if prog.globals[*id as usize].thread_local => {
                    (bir::RelocKind::Tls, u64::from(*id))
                }
                RelocTarget::Global(id) => (bir::RelocKind::Data, m.global_object(*id)),
                RelocTarget::Str(id) => {
                    let blob = m.string_blob(*id);
                    (bir::RelocKind::Data, m.blob_object(blob))
                }
                RelocTarget::Func(id) => match m.func_index[*id as usize] {
                    Some(index) => (bir::RelocKind::Func, u64::from(index)),
                    None => (bir::RelocKind::Extern, u64::from(m.extern_for(*id)?)),
                },
            };
            pending.push(PendingReloc {
                object: gi as u64,
                offset: r.offset,
                kind,
                target,
                addend: r.addend,
            });
        }
    }

    // Lay out the data segment: objects with initial bytes first, zero-filled ones last.
    let nglobals = prog.globals.len();
    let nobjects = nglobals + m.blobs.len();
    let mut offsets = vec![0u64; nobjects];
    let mut image: Vec<u8> = Vec::new();
    let mut size: u64 = 0;
    let mut align: u64 = 1;
    let global_layout = |g: &Global| -> (u64, u64) {
        (
            tcx.size_of(&g.ty).unwrap_or(0) + g.extra_size,
            tcx.align_of(&g.ty).unwrap_or(1).max(g.align.unwrap_or(1)),
        )
    };
    let is_initialized = |g: &Global| !g.init.is_empty() || !g.relocs.is_empty();
    for (i, g) in prog.globals.iter().enumerate() {
        if !g.defined || g.thread_local || !is_initialized(g) {
            continue;
        }
        let (gsize, galign) = global_layout(g);
        align = align.max(galign);
        size = size.next_multiple_of(galign);
        offsets[i] = size;
        image.resize(size as usize, 0);
        image.extend_from_slice(&g.init);
        size += gsize;
    }
    for (i, blob) in m.blobs.iter().enumerate() {
        offsets[nglobals + i] = size;
        image.resize(size as usize, 0);
        image.extend_from_slice(blob);
        size += blob.len() as u64;
    }
    for (i, g) in prog.globals.iter().enumerate() {
        if !g.defined || g.thread_local || is_initialized(g) {
            continue;
        }
        let (gsize, galign) = global_layout(g);
        align = align.max(galign);
        size = size.next_multiple_of(galign);
        offsets[i] = size;
        size += gsize;
    }

    // The thread-local objects get a segment of their own, laid out the same way.
    let mut tls = bir::Tls {
        size: 0,
        align: 1,
        init: Vec::new(),
        relocs: Vec::new(),
    };
    let mut tls_offsets = vec![0u64; nglobals];
    for initialized in [true, false] {
        for (i, g) in prog.globals.iter().enumerate() {
            if !g.defined || !g.thread_local || is_initialized(g) != initialized {
                continue;
            }
            let (gsize, galign) = global_layout(g);
            tls.align = tls.align.max(galign);
            tls.size = tls.size.next_multiple_of(galign);
            tls_offsets[i] = tls.size;
            if initialized {
                tls.init.resize(tls.size as usize, 0);
                tls.init.extend_from_slice(&g.init);
            }
            tls.size += gsize;
        }
    }

    let mut relocs = Vec::with_capacity(pending.len());
    for r in pending {
        let in_tls = prog.globals[r.object as usize].thread_local;
        let base = if in_tls {
            tls_offsets[r.object as usize]
        } else {
            offsets[r.object as usize]
        };
        let offset = base + r.offset;
        let (index, addend) = match r.kind {
            bir::RelocKind::Data => (offsets[r.target as usize], r.addend),
            bir::RelocKind::Tls => (tls_offsets[r.target as usize], r.addend),
            _ => (r.target, r.addend),
        };
        // Keep the relocated words inside the initialized prefix.
        let end = (offset + 8) as usize;
        let (segment, table) = if in_tls {
            (&mut tls.init, &mut tls.relocs)
        } else {
            (&mut image, &mut relocs)
        };
        if segment.len() < end {
            segment.resize(end, 0);
        }
        table.push(bir::Reloc {
            offset,
            kind: r.kind,
            index,
            addend,
        });
    }
    if image.len() as u64 > size {
        size = image.len() as u64;
    }

    for func in &mut funcs {
        for block in &mut func.blocks {
            for inst in block {
                match inst {
                    Inst::DataAddr(object) => *object = offsets[*object as usize],
                    Inst::TlsAddr(object) => *object = tls_offsets[*object as usize],
                    _ => {}
                }
            }
        }
    }

    let mut objects = Vec::with_capacity(nobjects);
    let mut tls_objects = Vec::new();
    for (i, g) in prog.globals.iter().enumerate() {
        if !g.defined {
            continue;
        }
        let (gsize, galign) = global_layout(g);
        let (table, offset) = if g.thread_local {
            (&mut tls_objects, tls_offsets[i])
        } else {
            (&mut objects, offsets[i])
        };
        table.push(crate::link::DataObject {
            offset,
            size: gsize,
            align: galign,
            symbol: (!g.is_static).then(|| g.link_name.as_ref().unwrap_or(&g.name).to_string()),
            initialized: g.has_initializer,
            content: is_initialized(g),
        });
    }
    for (i, blob) in m.blobs.iter().enumerate() {
        objects.push(crate::link::DataObject {
            offset: offsets[nglobals + i],
            size: blob.len() as u64,
            align: 1,
            symbol: None,
            initialized: true,
            content: true,
        });
    }
    objects.sort_by_key(|o| (o.offset, o.size));
    tls_objects.sort_by_key(|o| (o.offset, o.size));

    // A private function only code that was never emitted calls (the dead arm of `if (0)`)
    // is not emitted either.
    let mut live = vec![false; funcs.len()];
    let mut work: Vec<u32> = (0..funcs.len() as u32)
        .filter(|&i| funcs[i as usize].exported)
        .collect();
    work.extend(constructors.iter().chain(&destructors).map(|&(_, f)| f));
    work.extend(function_aliases.iter().map(|(_, f)| *f));
    work.extend(
        relocs
            .iter()
            .chain(&tls.relocs)
            .filter(|r| r.kind == bir::RelocKind::Func)
            .map(|r| r.index as u32),
    );
    while let Some(f) = work.pop() {
        if std::mem::replace(&mut live[f as usize], true) {
            continue;
        }
        for inst in funcs[f as usize].blocks.iter().flatten() {
            if let Inst::FuncAddr(callee) | Inst::Call(callee, _) = inst {
                work.push(*callee);
            }
        }
    }
    if live.contains(&false) {
        let mut renumbered = Vec::with_capacity(live.len());
        let mut kept = 0u32;
        for &is_live in &live {
            renumbered.push(kept);
            kept += u32::from(is_live);
        }
        let mut index = 0;
        funcs.retain(|_| {
            index += 1;
            live[index - 1]
        });
        for func in &mut funcs {
            for inst in func.blocks.iter_mut().flatten() {
                if let Inst::FuncAddr(callee) | Inst::Call(callee, _) = inst {
                    *callee = renumbered[*callee as usize];
                }
            }
        }
        for reloc in relocs.iter_mut().chain(&mut tls.relocs) {
            if reloc.kind == bir::RelocKind::Func {
                reloc.index = u64::from(renumbered[reloc.index as usize]);
            }
        }
        for export in &mut exports {
            export.func = renumbered[export.func as usize];
        }
        for (_, f) in constructors.iter_mut().chain(&mut destructors) {
            *f = renumbered[*f as usize];
        }
        for (_, f) in &mut function_aliases {
            *f = renumbered[*f as usize];
        }
    }

    // An extern only code that was never emitted mentioned is not required of whoever loads
    // the module.
    let mut used = vec![false; m.externs.len()];
    for func in &funcs {
        for inst in func.blocks.iter().flatten() {
            if let Inst::ExternAddr(e) | Inst::CallExtern(e, _) = inst {
                used[*e as usize] = true;
            }
        }
    }
    for reloc in relocs.iter().chain(&tls.relocs) {
        if reloc.kind == bir::RelocKind::Extern {
            used[reloc.index as usize] = true;
        }
    }
    let mut renumbered = Vec::with_capacity(used.len());
    let mut kept = 0u32;
    for &is_used in &used {
        renumbered.push(kept);
        kept += u32::from(is_used);
    }
    if kept as usize != used.len() {
        let mut index = 0;
        m.externs.retain(|_| {
            index += 1;
            used[index - 1]
        });
        for func in &mut funcs {
            for inst in func.blocks.iter_mut().flatten() {
                if let Inst::ExternAddr(e) | Inst::CallExtern(e, _) = inst {
                    *e = renumbered[*e as usize];
                }
            }
        }
        for reloc in relocs.iter_mut().chain(&mut tls.relocs) {
            if reloc.kind == bir::RelocKind::Extern {
                reloc.index = u64::from(renumbered[reloc.index as usize]);
            }
        }
        m.tls_externs.retain(|t| used[t.index as usize]);
        for t in &mut m.tls_externs {
            t.index = renumbered[t.index as usize];
        }
        m.runtime_externs.retain(|_, index| used[*index as usize]);
        for index in m.runtime_externs.values_mut() {
            *index = renumbered[*index as usize];
        }
    }

    let module = bir::Module {
        arch: tcx.target.bir_arch(),
        os: tcx.target.bir_os(),
        sigs: m.sigs,
        externs: m.externs,
        data: bir::Data {
            size,
            align,
            init: image,
            relocs,
        },
        tls,
        funcs,
        exports,
        libraries: Vec::new(),
        constructors: initializer_order(&constructors, false),
        destructors: initializer_order(&destructors, true),
    };
    Ok(Unit {
        module,
        replaced_aggregates: m.replaced_aggregates,
        combined_accesses: (m.combined_loads, m.combined_stores),
        objects,
        tls_objects,
        tls_externs: m.tls_externs,
        constructors,
        destructors,
        function_aliases,
        runtime_externs: m
            .runtime_externs
            .iter()
            .filter(|(name, _)| {
                matches!(
                    name.as_str(),
                    "__udivti3" | "__umodti3" | "__divti3" | "__modti3"
                )
            })
            .map(|(_, &index)| index)
            .collect(),
    })
}

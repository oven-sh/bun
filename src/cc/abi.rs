//! C calling conventions: how each target passes and returns scalars, structs and unions.
//!
//! BIR signatures describe machine-level calls, so the frontend decides here which
//! aggregates travel as register-sized pieces, which are copied into the stack argument
//! area, which go by reference, and which results come back through memory. The register
//! accounting for a whole parameter list lives here too, because the "all in registers or
//! all in memory" rules depend on what came before.
//!
//! Implemented: x86-64 System V (psABI 3.2.3), AArch64 AAPCS64 (Linux and Apple) and Win64.
//!
//! 16-byte vectors are single V128 values (SSE class / one v register; by reference on
//! Win64). Inside aggregates, System V classifies a vector's halves as SSE and SSEUP and
//! merges them per eightbyte exactly as the psABI says; AAPCS64 recognises homogeneous
//! short-vector aggregates.

use crate::bir::{Exhausts, Param, Ty};
use crate::types::{Arch, Os, Type, TypeCtx};

/// One register-sized part of an aggregate.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) struct Piece {
    /// Where the part starts inside the object.
    pub(crate) offset: u64,
    /// How many bytes of the object it carries (1 to 8, or 16 for a V128 piece); never
    /// reaches past the object.
    pub(crate) bytes: u64,
    /// The BIR value type that carries it.
    pub(crate) ty: Ty,
}

/// How one argument is passed.
#[derive(Clone, PartialEq, Eq, Debug)]
pub(crate) enum ArgPass {
    /// A scalar, in a register of its class.
    Scalar(Ty),
    /// An aggregate split over registers. A piece with `bytes == 0` is a padding register
    /// (AArch64 starts 16-byte-aligned composites at an even register).
    Pieces(Vec<Piece>),
    /// An aggregate copied into the stack argument area.
    Stack {
        size: u64,
        align: u64,
        exhausts: Exhausts,
    },
    /// The address of a copy the caller makes.
    Reference,
    /// An empty struct: nothing is passed.
    Ignore,
}

/// How a result comes back.
#[derive(Clone, PartialEq, Eq, Debug)]
pub(crate) enum RetPass {
    Void,
    Scalar(Ty),
    Pieces(Vec<Piece>),
    /// Through memory whose address is a hidden first integer argument; the function also
    /// returns that address (x86-64 System V, Win64).
    HiddenPointer,
    /// Through memory whose address is the `IndirectResult` parameter (AArch64 x8).
    Indirect,
    /// A `long double`, or an aggregate that is one and nothing else, on top of the x87 register
    /// stack (x86-64 System V), which the machine signature says nothing about: the function
    /// ends with `X87Op::LoadReturn` and the caller follows the call with `X87Op::StoreResult`.
    X87,
}

/// The machine-level shape of one call or definition.
#[derive(Clone, PartialEq, Eq, Debug)]
pub(crate) struct CallAbi {
    pub(crate) ret: RetPass,
    pub(crate) rets: Vec<Ty>,
    /// One entry per C argument, named ones first.
    pub(crate) args: Vec<ArgPass>,
    /// Parameters of the named arguments, including a leading hidden or indirect result.
    pub(crate) named_params: Vec<Param>,
    /// Parameters of the anonymous (variadic) arguments of this particular call.
    pub(crate) anonymous_params: Vec<Param>,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Leaf {
    Int,
    F32,
    F64,
    V128,
    /// An 8-byte vector: System V class SSE like a `double`, and an AAPCS64 short vector,
    /// which makes a homogeneous aggregate only with its own kind.
    V64,
    /// An x87 `long double`: classes X87 and X87UP.
    X87,
}

/// A scalar member of a flattened aggregate.
#[derive(Clone, Copy, Debug)]
struct Field {
    offset: u64,
    size: u64,
    kind: Leaf,
    /// Its natural alignment (bit-field storage has none to honour).
    align: u64,
}

/// Flattens `ty` into scalar fields. Fails on member types that cannot be passed at all.
fn flatten(tcx: &TypeCtx, ty: &Type, base: u64, out: &mut Vec<Field>) -> Result<(), String> {
    match ty {
        Type::Struct(id) => {
            for m in &tcx.struct_def(*id).members {
                match m.bitfield {
                    Some(field) => {
                        let bytes = field.bytes();
                        out.push(Field {
                            offset: base + m.offset,
                            size: bytes,
                            kind: Leaf::Int,
                            align: 1,
                        });
                    }
                    None => flatten(tcx, &m.ty, base + m.offset, out)?,
                }
            }
            Ok(())
        }
        Type::Array(elem, len) => {
            let esize = tcx.size_of(elem).unwrap_or(0);
            for i in 0..len.unwrap_or(0) {
                flatten(tcx, elem, base + i * esize, out)?;
                // A long array is memory class anyway; its first elements are enough.
                if out.len() > 64 {
                    break;
                }
            }
            Ok(())
        }
        Type::Wide(crate::types::WideKind::LongDouble) => {
            out.push(Field {
                offset: base,
                size: 16,
                kind: Leaf::X87,
                align: 16,
            });
            Ok(())
        }
        Type::Wide(kind) => Err(format!(
            "passing or returning a struct that contains '{}' is not supported yet",
            kind.name()
        )),
        Type::Atomic(inner) | Type::Qualified(_, inner) => flatten(tcx, inner, base, out),
        Type::Vector(..) if tcx.is_half_vector(ty) => {
            check_vector(tcx, ty)?;
            out.push(Field {
                offset: base,
                size: 8,
                kind: Leaf::V64,
                align: 8,
            });
            Ok(())
        }
        Type::Vector(..) => {
            check_vector(tcx, ty)?;
            out.push(Field {
                offset: base,
                size: 16,
                kind: Leaf::V128,
                align: 16,
            });
            Ok(())
        }
        Type::ComplexFloat | Type::ComplexDouble => {
            let part = if matches!(ty, Type::ComplexFloat) {
                Type::Float
            } else {
                Type::Double
            };
            let size = tcx.size_of(&part).unwrap_or(0);
            flatten(tcx, &part, base, out)?;
            flatten(tcx, &part, base + size, out)
        }
        Type::Int128 | Type::UInt128 => {
            // Two eightbytes of one 16-byte aligned integer.
            for half in 0..2 {
                out.push(Field {
                    offset: base + half * 8,
                    size: 8,
                    kind: Leaf::Int,
                    align: if half == 0 { 16 } else { 8 },
                });
            }
            Ok(())
        }
        Type::Float => {
            out.push(Field {
                offset: base,
                size: 4,
                kind: Leaf::F32,
                align: 4,
            });
            Ok(())
        }
        Type::Double | Type::LongDouble64 => {
            out.push(Field {
                offset: base,
                size: 8,
                kind: Leaf::F64,
                align: 8,
            });
            Ok(())
        }
        other => {
            let size = tcx.size_of(other).unwrap_or(0);
            out.push(Field {
                offset: base,
                size,
                kind: Leaf::Int,
                align: size.max(1),
            });
            Ok(())
        }
    }
}

fn check_vector(tcx: &TypeCtx, ty: &Type) -> Result<(), String> {
    if ty.is_vector() && !matches!(tcx.size_of(ty), Some(8 | 16)) {
        return Err(crate::sema::simd::VECTOR_SIZES.to_string());
    }
    // GCC passes and returns it in memory, Clang returns it in a register.
    let sysv =
        tcx.target.arch == crate::types::Arch::X86_64 && tcx.target.os != crate::types::Os::Windows;
    if sysv && tcx.is_half_vector(ty) && matches!(ty.unatomic().vector_elem(), Some(Type::Double)) {
        return Err(
            "passing or returning a one-element vector of 'double' is not supported for this target: GCC and Clang disagree on how"
                .to_string(),
        );
    }
    Ok(())
}

fn int_piece(offset: u64, bytes: u64) -> Piece {
    Piece {
        offset,
        bytes,
        ty: if bytes <= 4 { Ty::I32 } else { Ty::I64 },
    }
}

/// Splits the first `size` bytes into integer pieces of up to 8 bytes.
fn int_pieces(size: u64) -> Vec<Piece> {
    (0..size.div_ceil(8))
        .map(|i| int_piece(i * 8, (size - i * 8).min(8)))
        .collect()
}

/// x86-64 System V classification of an aggregate (psABI 3.2.3): `None` is class MEMORY.
pub(crate) fn sysv_classify(tcx: &TypeCtx, ty: &Type) -> Result<Option<Vec<Piece>>, String> {
    let size = tcx.size_of(ty).unwrap_or(0);
    let mut fields = Vec::new();
    flatten(tcx, ty, 0, &mut fields)?;
    if size > 16 || fields.iter().any(|f| f.offset % f.align != 0) {
        return Ok(None);
    }
    // X87 merged with anything else is MEMORY, and X87UP without an X87 before it is too. What
    // is left is the aggregate that holds exactly one `long double`: MEMORY as an argument.
    if fields.iter().any(|f| f.kind == Leaf::X87) {
        return Ok(None);
    }
    #[derive(Clone, Copy, PartialEq)]
    enum Class {
        Integer,
        Sse,
        SseUp,
    }
    // INTEGER wins when an eightbyte mixes classes (an all-padding eightbyte is INTEGER
    // too), then SSE; SSEUP survives only where nothing but upper vector halves live.
    let classes: Vec<Class> = (0..size.div_ceil(8))
        .map(|i| {
            let (start, end) = (i * 8, (i * 8 + 8).min(size));
            let inside = |f: &&Field| f.offset < end && f.offset + f.size > start;
            let is_upper_half = |f: &Field| f.kind == Leaf::V128 && f.offset != start;
            let count = fields.iter().filter(inside).count();
            if count == 0 || fields.iter().filter(inside).any(|f| f.kind == Leaf::Int) {
                Class::Integer
            } else if fields.iter().filter(inside).all(is_upper_half) {
                Class::SseUp
            } else {
                Class::Sse
            }
        })
        .collect();
    if classes == [Class::Sse, Class::SseUp] {
        return Ok(Some(vec![Piece {
            offset: 0,
            bytes: 16,
            ty: Ty::V128,
        }]));
    }
    let mut pieces = Vec::new();
    for (i, class) in classes.iter().enumerate() {
        let i = i as u64;
        let (start, end) = (i * 8, (i * 8 + 8).min(size));
        // An SSEUP that does not follow an SSE becomes SSE.
        let all_float = *class != Class::Integer;
        let bytes = end - start;
        pieces.push(if !all_float {
            int_piece(start, bytes)
        } else if bytes <= 4 {
            Piece {
                offset: start,
                bytes,
                ty: Ty::F32,
            }
        } else {
            // A double, or two floats travelling together in one SSE register.
            Piece {
                offset: start,
                bytes,
                ty: Ty::F64,
            }
        });
    }
    Ok(Some(pieces))
}

/// AAPCS64 homogeneous aggregate: one to four members of one float or short-vector type.
fn hfa_pieces(tcx: &TypeCtx, ty: &Type) -> Result<Option<Vec<Piece>>, String> {
    let mut fields = Vec::new();
    flatten(tcx, ty, 0, &mut fields)?;
    // Union members that share an offset count once.
    fields.sort_by_key(|f| f.offset);
    fields.dedup_by(|b, a| a.offset == b.offset && a.kind == b.kind);
    let Some(first) = fields.first().copied() else {
        return Ok(None);
    };
    if first.kind == Leaf::Int || fields.len() > 4 || fields.iter().any(|f| f.kind != first.kind) {
        return Ok(None);
    }
    if fields.len() as u64 * first.size != tcx.size_of(ty).unwrap_or(0) {
        return Ok(None);
    }
    let ty = match first.kind {
        Leaf::F32 => Ty::F32,
        Leaf::V128 => Ty::V128,
        _ => Ty::F64,
    };
    Ok(Some(
        fields
            .iter()
            .map(|f| Piece {
                offset: f.offset,
                bytes: f.size,
                ty,
            })
            .collect(),
    ))
}

/// Register bookkeeping while walking a parameter list.
struct Registers {
    int_free: u32,
    float_free: u32,
}

impl Registers {
    fn take_int(&mut self, n: u32) -> bool {
        if self.int_free >= n {
            self.int_free -= n;
            return true;
        }
        false
    }

    fn take_float(&mut self, n: u32) -> bool {
        if self.float_free >= n {
            self.float_free -= n;
            return true;
        }
        false
    }

    /// A scalar takes a register if one is left; otherwise the backend puts it on the stack.
    fn scalar(&mut self, ty: Ty) {
        if ty.uses_float_registers() {
            self.float_free = self.float_free.saturating_sub(1);
        } else {
            self.int_free = self.int_free.saturating_sub(1);
        }
    }
}

fn count_classes(pieces: &[Piece]) -> (u32, u32) {
    let floats = pieces
        .iter()
        .filter(|p| p.ty.uses_float_registers())
        .count() as u32;
    (pieces.len() as u32 - floats, floats)
}

/// Types passed the way a struct is: `__int128` is two integer eightbytes, a complex number
/// is classified as the struct of its two parts, and an x87 `long double` is in memory.
fn is_aggregate(ty: &Type) -> bool {
    ty.is_struct() || ty.is_pair() || ty.is_long_double()
}

/// An aggregate that is one x87 `long double` and nothing else comes back the way a bare
/// one does.
fn is_only_long_double(tcx: &TypeCtx, ty: &Type) -> Result<bool, String> {
    let mut fields = Vec::new();
    flatten(tcx, ty, 0, &mut fields)?;
    Ok(tcx.size_of(ty) == Some(16) && fields.iter().all(|f| f.kind == Leaf::X87))
}

/// Works out how a call with result type `ret` and arguments `args` (the first `named` of
/// them declared parameters, the rest variadic) is made on `tcx.target`.
pub(crate) fn lower_call(
    tcx: &TypeCtx,
    ret: &Type,
    args: &[Type],
    named: usize,
) -> Result<CallAbi, String> {
    let target = tcx.target;
    let windows = target.os == Os::Windows;
    let arm = target.arch == Arch::Aarch64;
    let apple_arm = arm && target.os == Os::MacOs;
    let mut regs = if arm {
        Registers {
            int_free: 8,
            float_free: 8,
        }
    } else if windows {
        Registers {
            int_free: 4,
            float_free: 4,
        }
    } else {
        Registers {
            int_free: 6,
            float_free: 8,
        }
    };
    let mut named_params: Vec<Param> = Vec::new();
    let mut anonymous_params: Vec<Param> = Vec::new();

    check_vector(tcx, ret)?;
    for arg in args {
        check_vector(tcx, arg)?;
    }

    // The result.
    let ret_size = tcx.size_of(ret).unwrap_or(0);
    let ret_pass = if ret.is_void() {
        RetPass::Void
    } else if ret.is_long_double()
        || (ret.is_struct() && !windows && !arm && is_only_long_double(tcx, ret)?)
    {
        RetPass::X87
    } else if !is_aggregate(ret) {
        RetPass::Scalar(tcx.machine_ty(ret))
    } else if ret_size == 0 {
        RetPass::Void
    } else if windows {
        if matches!(ret_size, 1 | 2 | 4 | 8) {
            flatten(tcx, ret, 0, &mut Vec::new())?;
            RetPass::Pieces(vec![int_piece(0, ret_size)])
        } else {
            RetPass::HiddenPointer
        }
    } else if arm {
        match hfa_pieces(tcx, ret)? {
            Some(pieces) => RetPass::Pieces(pieces),
            None if ret_size <= 16 => RetPass::Pieces(int_pieces(ret_size)),
            None => RetPass::Indirect,
        }
    } else {
        match sysv_classify(tcx, ret)? {
            Some(pieces) => RetPass::Pieces(pieces),
            None => RetPass::HiddenPointer,
        }
    };
    let rets: Vec<Ty> = match &ret_pass {
        RetPass::Void | RetPass::Indirect | RetPass::X87 => Vec::new(),
        RetPass::Scalar(t) => vec![*t],
        RetPass::Pieces(pieces) => pieces.iter().map(|p| p.ty).collect(),
        RetPass::HiddenPointer => vec![Ty::I64],
    };
    match ret_pass {
        RetPass::HiddenPointer => {
            named_params.push(Param::Value(Ty::I64));
            regs.scalar(Ty::I64);
        }
        RetPass::Indirect => named_params.push(Param::IndirectResult),
        _ => {}
    }

    let mut passes = Vec::with_capacity(args.len());
    // Apple's arm64 convention: named arguments that miss the registers are packed on the stack at
    // their natural alignment, and every anonymous one follows in eight-byte slots. A 16-byte
    // aligned anonymous argument needs to know where it lands to pad itself.
    let mut apple_named_stack_bytes: u64 = 0;
    let mut apple_anonymous_slots: u64 = 0;
    for (index, arg) in args.iter().enumerate() {
        let anonymous = index >= named;
        let size = tcx.size_of(arg).unwrap_or(0);
        let align = tcx.align_of(arg).unwrap_or(1);
        let pass = if windows && !arm && arg.is_vector() && !tcx.is_half_vector(arg) {
            regs.scalar(Ty::I64);
            ArgPass::Reference
        } else if !is_aggregate(arg) {
            let ty = tcx.machine_ty(arg);
            if apple_arm {
                let free = if ty.uses_float_registers() {
                    regs.float_free
                } else {
                    regs.int_free
                };
                if anonymous {
                    apple_anonymous_slots += size.div_ceil(8).max(1);
                } else if free == 0 {
                    let natural = size.max(1);
                    apple_named_stack_bytes =
                        apple_named_stack_bytes.next_multiple_of(natural) + natural;
                }
            }
            regs.scalar(ty);
            ArgPass::Scalar(ty)
        } else if size == 0 {
            ArgPass::Ignore
        } else if windows {
            flatten(tcx, arg, 0, &mut Vec::new())?;
            if matches!(size, 1 | 2 | 4 | 8) {
                ArgPass::Pieces(vec![int_piece(0, size)])
            } else {
                ArgPass::Reference
            }
        } else if arm {
            if size > 16 && hfa_pieces(tcx, arg)?.is_none() {
                regs.scalar(Ty::I64);
                ArgPass::Reference
            } else if apple_arm && anonymous {
                // Apple passes every variadic argument on the stack in 8-byte slots, which is
                // also where the backend puts anonymous values: integer pieces give the same bytes.
                flatten(tcx, arg, 0, &mut Vec::new())?;
                if size > 16 {
                    apple_anonymous_slots += 1;
                    ArgPass::Reference
                } else {
                    let mut pieces = int_pieces(size);
                    let slot = apple_named_stack_bytes.div_ceil(8) + apple_anonymous_slots;
                    if align >= 16 && slot % 2 == 1 {
                        pieces.insert(
                            0,
                            Piece {
                                offset: 0,
                                bytes: 0,
                                ty: Ty::I64,
                            },
                        );
                    }
                    apple_anonymous_slots += pieces.len() as u64;
                    ArgPass::Pieces(pieces)
                }
            } else if let Some(pieces) = hfa_pieces(tcx, arg)? {
                if regs.take_float(pieces.len() as u32) {
                    ArgPass::Pieces(pieces)
                } else {
                    regs.float_free = 0;
                    apple_named_stack_bytes = apple_named_stack_bytes
                        .next_multiple_of(align.max(8))
                        + size.next_multiple_of(8);
                    ArgPass::Stack {
                        size: size.next_multiple_of(8),
                        align: align.max(8),
                        exhausts: Exhausts::FloatRegisters,
                    }
                }
            } else {
                let mut pieces = int_pieces(size);
                let used = 8 - regs.int_free;
                if align >= 16 && used % 2 == 1 && regs.int_free > pieces.len() as u32 {
                    pieces.insert(
                        0,
                        Piece {
                            offset: 0,
                            bytes: 0,
                            ty: Ty::I64,
                        },
                    );
                }
                if regs.take_int(pieces.len() as u32) {
                    ArgPass::Pieces(pieces)
                } else {
                    regs.int_free = 0;
                    let align = if align >= 16 { 16 } else { 8 };
                    apple_named_stack_bytes =
                        apple_named_stack_bytes.next_multiple_of(align) + size.next_multiple_of(8);
                    ArgPass::Stack {
                        size: size.next_multiple_of(8),
                        align,
                        exhausts: Exhausts::IntegerRegisters,
                    }
                }
            }
        } else {
            let in_memory = ArgPass::Stack {
                size: size.next_multiple_of(8),
                align: align.max(8),
                exhausts: Exhausts::Nothing,
            };
            match sysv_classify(tcx, arg)? {
                None => in_memory,
                Some(pieces) => {
                    let (ints, floats) = count_classes(&pieces);
                    if regs.int_free >= ints && regs.float_free >= floats {
                        regs.take_int(ints);
                        regs.take_float(floats);
                        ArgPass::Pieces(pieces)
                    } else {
                        in_memory
                    }
                }
            }
        };
        let params = if anonymous {
            &mut anonymous_params
        } else {
            &mut named_params
        };
        match &pass {
            ArgPass::Scalar(t) => params.push(Param::Value(*t)),
            ArgPass::Pieces(pieces) => params.extend(pieces.iter().map(|p| Param::Value(p.ty))),
            ArgPass::Stack {
                size,
                align,
                exhausts,
            } => {
                params.push(Param::ByValStack {
                    size: *size,
                    align: *align,
                    exhausts: *exhausts,
                });
            }
            ArgPass::Reference => params.push(Param::Value(Ty::I64)),
            ArgPass::Ignore => {}
        }
        passes.push(pass);
    }
    Ok(CallAbi {
        ret: ret_pass,
        rets,
        args: passes,
        named_params,
        anonymous_params,
    })
}

//! C types and target data layout.

use std::rc::Rc;

use crate::bir;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Arch {
    X86_64,
    Aarch64,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Os {
    Linux,
    MacOs,
    Windows,
}

/// The machine C is being compiled for. It decides the size of `long`, the signedness of
/// plain `char`, and is recorded in the BIR header.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Target {
    pub arch: Arch,
    pub os: Os,
}

impl Target {
    pub fn host() -> Target {
        let arch = if cfg!(target_arch = "aarch64") {
            Arch::Aarch64
        } else {
            Arch::X86_64
        };
        let os = if cfg!(target_os = "macos") {
            Os::MacOs
        } else if cfg!(windows) {
            Os::Windows
        } else {
            Os::Linux
        };
        Target { arch, os }
    }

    /// Parses `x86_64-linux`, `aarch64-macos`, ...
    pub fn parse(s: &str) -> Option<Target> {
        let (arch, os) = match s {
            "x86_64-linux" => (Arch::X86_64, Os::Linux),
            "aarch64-linux" => (Arch::Aarch64, Os::Linux),
            "x86_64-macos" => (Arch::X86_64, Os::MacOs),
            "aarch64-macos" => (Arch::Aarch64, Os::MacOs),
            "x86_64-windows" => (Arch::X86_64, Os::Windows),
            "aarch64-windows" => (Arch::Aarch64, Os::Windows),
            _ => return None,
        };
        Some(Target { arch, os })
    }

    pub(crate) fn char_is_signed(self) -> bool {
        // AAPCS64 makes plain char unsigned; Apple and Windows arm64 keep it signed.
        !(self.arch == Arch::Aarch64 && self.os == Os::Linux)
    }

    /// Size of `long double` when it is a distinct, wider-than-double type; `None` where it
    /// is the same as `double`.
    pub(crate) fn long_double_size(self) -> Option<u64> {
        match (self.arch, self.os) {
            (_, Os::Windows) | (Arch::Aarch64, Os::MacOs) => None,
            _ => Some(16),
        }
    }

    /// Whether `long double` is the x87 80-bit format in a 16-byte object.
    pub(crate) fn long_double_is_x87(self) -> bool {
        self.arch == Arch::X86_64 && self.os != Os::Windows
    }

    pub(crate) fn long_double_type(self) -> Type {
        match self.long_double_size() {
            None => Type::Double,
            Some(_) if self.long_double_is_x87() => Type::Wide(WideKind::LongDouble),
            Some(_) => Type::Wide(WideKind::QuadLongDouble),
        }
    }

    pub(crate) fn long_size(self) -> u64 {
        if self.os == Os::Windows { 4 } else { 8 }
    }

    pub(crate) fn bir_arch(self) -> u8 {
        match self.arch {
            Arch::X86_64 => 0,
            Arch::Aarch64 => 1,
        }
    }

    pub(crate) fn bir_os(self) -> u8 {
        match self.os {
            Os::Linux => 0,
            Os::MacOs => 1,
            Os::Windows => 2,
        }
    }
}

pub(crate) type StructId = u32;

#[derive(Clone, PartialEq, Debug)]
pub(crate) enum Type {
    Void,
    Bool,
    Char,
    SChar,
    UChar,
    Short,
    UShort,
    Int,
    UInt,
    Long,
    ULong,
    LLong,
    ULLong,
    Float,
    Double,
    /// 128-bit integers: two 64-bit halves in memory, low half first.
    Int128,
    UInt128,
    /// `float _Complex` / `double _Complex`: the real part then the imaginary part.
    ComplexFloat,
    ComplexDouble,
    Ptr(Rc<Type>),
    /// Element type and length; `None` is an incomplete array (`int a[]`).
    Array(Rc<Type>, Option<u64>),
    Func(Rc<FuncType>),
    /// A struct or union; the definition lives in [`TypeCtx::structs`].
    Struct(StructId),
    /// A type that can be declared, stored and copied but not computed with.
    Wide(WideKind),
    /// A variable length array: the element type and an index into `Sema::vlas`, which
    /// knows the local variable that holds the element count once the declaration has
    /// been reached.
    Vla(Rc<Type>, u32),
    /// A GCC/Clang vector: element type and element count. Only 16-byte vectors can be
    /// computed with; other sizes can be named (in typedefs) but not used.
    Vector(Rc<Type>, u32),
    /// `_Atomic T`, for a scalar `T` of 1, 2, 4 or 8 bytes. Only lvalues have this type:
    /// reading one yields a plain `T`.
    Atomic(Rc<Type>),
    /// `const` / `volatile` / `restrict` applied to a type. Only lvalues (and the pointees
    /// of pointers) have such a type; values never do. The qualifiers are never empty, and
    /// never wrap an array (its elements are qualified instead), a function, an atomic type
    /// or another qualified type.
    Qualified(Quals, Rc<Type>),
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum WideKind {
    /// The x87 80-bit format (x86-64 outside Windows): an arithmetic type whose values live in
    /// memory, see `x87.rs`.
    LongDouble,
    /// `long double` where it is IEEE binary128 (AArch64 Linux). Declarations only, like the
    /// rest.
    QuadLongDouble,
    ComplexLongDouble,
    /// `__float128` / `_Float128`: IEEE binary128.
    Float128,
    ComplexFloat128,
}

impl WideKind {
    pub(crate) fn name(self) -> &'static str {
        match self {
            WideKind::LongDouble | WideKind::QuadLongDouble => "long double",
            WideKind::ComplexLongDouble => "long double _Complex",
            WideKind::Float128 => "_Float128",
            WideKind::ComplexFloat128 => "_Float128 _Complex",
        }
    }
}

/// A bit-field's place inside its storage unit.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) struct BitField {
    /// Bits from the least significant end of the byte at the member's offset (0 to 7).
    pub(crate) bit_offset: u32,
    pub(crate) width: u32,
    /// How many bytes at the member's offset may be read with one load (a power of two that
    /// covers the field and stays inside the struct), or 0 if only the bytes that hold the
    /// field may be touched. Stores never write more than those.
    pub(crate) readable: u32,
}

impl BitField {
    /// The bytes that hold the field: 1 to 9.
    pub(crate) fn bytes(self) -> u64 {
        u64::from(self.bit_offset + self.width).div_ceil(8)
    }
}

#[derive(Clone, PartialEq, Debug)]
pub(crate) struct FuncType {
    pub(crate) ret: Type,
    pub(crate) params: Vec<Type>,
    pub(crate) variadic: bool,
    /// Declared with an empty parameter list `()`: the parameters are unknown.
    pub(crate) unprototyped: bool,
}

#[derive(Clone, Debug)]
pub(crate) struct Member {
    /// `None` for an anonymous struct/union member.
    pub(crate) name: Option<Rc<str>>,
    pub(crate) ty: Type,
    /// Byte offset of the member, or of the storage unit that holds a bit-field.
    pub(crate) offset: u64,
    pub(crate) bitfield: Option<BitField>,
}

#[derive(Clone, Debug)]
pub(crate) struct StructDef {
    pub(crate) tag: Option<Rc<str>>,
    pub(crate) is_union: bool,
    pub(crate) complete: bool,
    pub(crate) members: Vec<Member>,
    pub(crate) size: u64,
    pub(crate) align: u64,
    /// `__attribute__((transparent_union))`: a parameter of this type takes an argument
    /// of any member's type, passed the way the first member is.
    pub(crate) transparent: bool,
}

pub(crate) struct TypeCtx {
    pub(crate) target: Target,
    pub(crate) structs: Vec<StructDef>,
}

/// A set of type qualifiers, and the alignment a typedef gave the type with
/// `__attribute__((aligned(n)))` (which, unlike on an object, can lower it).
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub(crate) struct Quals(u16);

impl Quals {
    pub(crate) const NONE: Quals = Quals(0);
    pub(crate) const CONST: Quals = Quals(1);
    pub(crate) const VOLATILE: Quals = Quals(2);
    pub(crate) const RESTRICT: Quals = Quals(4);
    const QUALIFIERS: u16 = 7;
    /// log2(alignment) + 1 in these bits; 0 when the type has its natural alignment.
    const ALIGN_SHIFT: u32 = 8;

    pub(crate) fn is_empty(self) -> bool {
        self.0 == 0
    }

    pub(crate) fn has(self, other: Quals) -> bool {
        self.0 & other.0 == other.0
    }

    /// Both sets of qualifiers; `other`'s alignment if it has one.
    pub(crate) fn with(self, other: Quals) -> Quals {
        let align = if other.0 >> Self::ALIGN_SHIFT != 0 {
            other.0
        } else {
            self.0
        };
        Quals(((self.0 | other.0) & Self::QUALIFIERS) | (align & !Self::QUALIFIERS))
    }

    pub(crate) fn without(self, other: Quals) -> Quals {
        Quals(self.0 & !(other.0 & Self::QUALIFIERS))
    }

    /// Only `const`, `volatile` and `restrict`.
    pub(crate) fn qualifiers(self) -> Quals {
        Quals(self.0 & Self::QUALIFIERS)
    }

    pub(crate) fn alignment(self) -> Option<u64> {
        match self.0 >> Self::ALIGN_SHIFT {
            0 => None,
            n => Some(1 << (n - 1)),
        }
    }

    /// `align` is a power of two up to 2^28.
    pub(crate) fn aligned(align: u64) -> Quals {
        Quals(((align.trailing_zeros() as u16 + 1) & 0x3f) << Self::ALIGN_SHIFT)
    }
}

impl Type {
    pub(crate) fn ptr_to(self) -> Type {
        Type::Ptr(Rc::new(self))
    }

    /// The type without its top-level qualifiers.
    pub(crate) fn unqualified(&self) -> &Type {
        match self {
            Type::Qualified(_, inner) => inner,
            other => other,
        }
    }

    /// The top-level qualifiers.
    pub(crate) fn quals(&self) -> Quals {
        match self {
            Type::Qualified(quals, _) => quals.qualifiers(),
            _ => Quals::NONE,
        }
    }

    /// The alignment a typedef gave the type, if one did.
    pub(crate) fn alignment(&self) -> Option<u64> {
        match self {
            Type::Qualified(quals, _) => quals.alignment(),
            _ => None,
        }
    }

    /// The type without that alignment.
    pub(crate) fn without_alignment(&self) -> Type {
        match self {
            Type::Qualified(quals, inner) if quals.alignment().is_some() => {
                (**inner).clone().qualified(quals.qualifiers())
            }
            other => other.clone(),
        }
    }

    /// The type as `typedef T name __attribute__((aligned(align)))` names it.
    pub(crate) fn with_alignment(self, align: u64) -> Type {
        match self {
            Type::Qualified(already, inner) => {
                Type::Qualified(already.with(Quals::aligned(align)), inner)
            }
            other => Type::Qualified(Quals::aligned(align), Rc::new(other)),
        }
    }

    /// `quals` added to this type.
    pub(crate) fn qualified(self, quals: Quals) -> Type {
        if quals.is_empty() {
            return self;
        }
        match self {
            // The elements are qualified; an alignment belongs to the array itself.
            Type::Array(..) | Type::Vla(..) if quals.alignment().is_some() => {
                let whole = Quals::NONE.with(quals).without(quals.qualifiers());
                let inner = self.qualified(quals.qualifiers());
                Type::Qualified(whole, Rc::new(inner))
            }
            Type::Array(elem, len) => Type::Array(Rc::new((*elem).clone().qualified(quals)), len),
            Type::Vla(elem, id) => Type::Vla(Rc::new((*elem).clone().qualified(quals)), id),
            Type::Func(_) | Type::Atomic(_) => self,
            Type::Qualified(already, inner) => Type::Qualified(already.with(quals), inner),
            other => Type::Qualified(quals, Rc::new(other)),
        }
    }

    pub(crate) fn is_const(&self) -> bool {
        self.quals().has(Quals::CONST)
    }

    pub(crate) fn is_integer(&self) -> bool {
        matches!(
            self.unqualified(),
            Type::Bool
                | Type::Char
                | Type::SChar
                | Type::UChar
                | Type::Short
                | Type::UShort
                | Type::Int
                | Type::UInt
                | Type::Long
                | Type::ULong
                | Type::LLong
                | Type::ULLong
                | Type::Int128
                | Type::UInt128
        )
    }

    pub(crate) fn is_int128(&self) -> bool {
        matches!(self.unqualified(), Type::Int128 | Type::UInt128)
    }

    pub(crate) fn is_complex(&self) -> bool {
        matches!(self.unqualified(), Type::ComplexFloat | Type::ComplexDouble)
    }

    /// The type of the real and imaginary parts of a complex type.
    pub(crate) fn complex_part(&self) -> Option<Type> {
        match self.unqualified() {
            Type::ComplexFloat => Some(Type::Float),
            Type::ComplexDouble => Some(Type::Double),
            _ => None,
        }
    }

    /// The complex type whose parts have floating type `part`.
    pub(crate) fn complex_of(part: &Type) -> Type {
        if matches!(part, Type::Float) {
            Type::ComplexFloat
        } else {
            Type::ComplexDouble
        }
    }

    /// Arithmetic types the frontend keeps in memory as two halves; an expression of such
    /// a type evaluates to the address of an object, like a struct.
    pub(crate) fn is_pair(&self) -> bool {
        self.is_int128() || self.is_complex()
    }

    /// `float` or `double`: the floating types whose values are BIR values.
    pub(crate) fn is_float(&self) -> bool {
        matches!(self.unqualified(), Type::Float | Type::Double)
    }

    /// The x87 `long double`: an arithmetic type whose value is an object in memory, so an
    /// expression of this type evaluates to that object's address.
    pub(crate) fn is_long_double(&self) -> bool {
        matches!(self.unqualified(), Type::Wide(WideKind::LongDouble))
    }

    pub(crate) fn is_real_floating(&self) -> bool {
        self.is_float() || self.is_long_double()
    }

    pub(crate) fn is_arith(&self) -> bool {
        self.is_integer() || self.is_real_floating()
    }

    pub(crate) fn is_ptr(&self) -> bool {
        matches!(self.unqualified(), Type::Ptr(_))
    }

    pub(crate) fn is_scalar(&self) -> bool {
        self.is_arith() || self.is_ptr()
    }

    pub(crate) fn is_struct(&self) -> bool {
        matches!(self.unqualified(), Type::Struct(_))
    }

    pub(crate) fn is_array(&self) -> bool {
        matches!(self.unqualified(), Type::Array(..) | Type::Vla(..))
    }

    pub(crate) fn is_func(&self) -> bool {
        matches!(self.unqualified(), Type::Func(_))
    }

    pub(crate) fn is_void(&self) -> bool {
        matches!(self.unqualified(), Type::Void)
    }

    pub(crate) fn is_vector(&self) -> bool {
        matches!(self.unqualified(), Type::Vector(..))
    }

    pub(crate) fn is_atomic(&self) -> bool {
        matches!(self, Type::Atomic(_))
    }

    /// Scalars and vectors: what an expression evaluates to as a BIR value rather than as
    /// the address of an object.
    pub(crate) fn is_value(&self) -> bool {
        (self.is_scalar() && !self.is_pair() && !self.is_long_double()) || self.is_vector()
    }

    /// The element type of a vector.
    pub(crate) fn vector_elem(&self) -> Option<&Type> {
        match self.unqualified() {
            Type::Vector(elem, _) => Some(elem),
            _ => None,
        }
    }

    /// The type of the value an lvalue of this type holds: without qualifiers and `_Atomic`.
    pub(crate) fn unatomic(&self) -> &Type {
        match self {
            Type::Atomic(inner) => inner,
            Type::Qualified(_, inner) => inner.unatomic(),
            other => other,
        }
    }

    pub(crate) fn is_volatile(&self) -> bool {
        self.quals().has(Quals::VOLATILE)
    }

    /// `volatile` applied to this type.
    pub(crate) fn volatile(self) -> Type {
        self.qualified(Quals::VOLATILE)
    }

    /// The pointed-to type of a pointer.
    pub(crate) fn pointee(&self) -> Option<&Type> {
        match self.unqualified() {
            Type::Ptr(t) => Some(t),
            _ => None,
        }
    }

    /// Conversion rank of an integer type (C11 6.3.1.1).
    pub(crate) fn rank(&self) -> u32 {
        match self.unqualified() {
            Type::Bool => 0,
            Type::Char | Type::SChar | Type::UChar => 1,
            Type::Short | Type::UShort => 2,
            Type::Int | Type::UInt => 3,
            Type::Long | Type::ULong => 4,
            Type::LLong | Type::ULLong => 5,
            Type::Int128 | Type::UInt128 => 6,
            _ => 0,
        }
    }

    pub(crate) fn to_unsigned(&self) -> Type {
        match self.unqualified() {
            Type::Char | Type::SChar => Type::UChar,
            Type::Short => Type::UShort,
            Type::Int => Type::UInt,
            Type::Long => Type::ULong,
            Type::LLong => Type::ULLong,
            Type::Int128 => Type::UInt128,
            other => other.clone(),
        }
    }
}

impl TypeCtx {
    pub(crate) fn new(target: Target) -> TypeCtx {
        TypeCtx {
            target,
            structs: Vec::new(),
        }
    }

    pub(crate) fn struct_def(&self, id: StructId) -> &StructDef {
        &self.structs[id as usize]
    }

    /// Size in bytes, or `None` for an incomplete type (and for functions and void).
    pub(crate) fn size_of(&self, ty: &Type) -> Option<u64> {
        Some(match ty {
            Type::Void | Type::Func(_) => return None,
            Type::Bool | Type::Char | Type::SChar | Type::UChar => 1,
            Type::Short | Type::UShort => 2,
            Type::Int | Type::UInt | Type::Float => 4,
            Type::Long | Type::ULong => self.target.long_size(),
            Type::LLong | Type::ULLong | Type::Double | Type::Ptr(_) | Type::ComplexFloat => 8,
            Type::Int128 | Type::UInt128 | Type::ComplexDouble => 16,
            Type::Array(elem, len) => self.size_of(elem)?.checked_mul((*len)?)?,
            // Known only at run time.
            Type::Vla(..) => return None,
            Type::Struct(id) => {
                let def = self.struct_def(*id);
                if !def.complete {
                    return None;
                }
                def.size
            }
            Type::Vector(elem, count) => self.size_of(elem)?.checked_mul(u64::from(*count))?,
            Type::Atomic(inner) | Type::Qualified(_, inner) => self.size_of(inner)?,
            Type::Wide(kind) => {
                let long_double = self.target.long_double_size().unwrap_or(8);
                match kind {
                    WideKind::LongDouble | WideKind::QuadLongDouble => long_double,
                    WideKind::ComplexLongDouble => long_double * 2,
                    WideKind::Float128 => 16,
                    WideKind::ComplexFloat128 => 32,
                }
            }
        })
    }

    pub(crate) fn align_of(&self, ty: &Type) -> Option<u64> {
        Some(match ty {
            Type::Array(elem, _) | Type::Vla(elem, _) => self.align_of(elem)?,
            Type::Struct(id) => {
                let def = self.struct_def(*id);
                if !def.complete {
                    return None;
                }
                def.align
            }
            Type::Qualified(quals, inner) => match quals.alignment() {
                Some(align) => align,
                None => self.align_of(inner)?,
            },
            Type::Atomic(inner) => self.align_of(inner)?,
            Type::ComplexFloat => 4,
            Type::ComplexDouble => 8,
            Type::Wide(WideKind::ComplexLongDouble) => self.target.long_double_size().unwrap_or(8),
            Type::Wide(WideKind::Float128 | WideKind::ComplexFloat128) => 16,
            other => self.size_of(other)?,
        })
    }

    pub(crate) fn is_complete(&self, ty: &Type) -> bool {
        match ty {
            Type::Vla(elem, _) => self.is_complete(elem),
            Type::Array(elem, Some(_)) if self.is_variably_sized(elem) => self.is_complete(elem),
            _ => self.size_of(ty).is_some(),
        }
    }

    /// Whether the size of `ty` is only known at run time: a variable length array, or an
    /// array of them.
    pub(crate) fn is_variably_sized(&self, ty: &Type) -> bool {
        match ty {
            Type::Vla(..) => true,
            Type::Array(elem, _) => self.is_variably_sized(elem),
            _ => false,
        }
    }

    /// The lane shape of a 16-byte vector type.
    pub(crate) fn lane_of(&self, ty: &Type) -> Option<bir::Lane> {
        let ty = ty.unatomic();
        let Type::Vector(elem, _) = ty else {
            return None;
        };
        if self.size_of(ty) != Some(16) {
            return None;
        }
        Some(match (&**elem, self.size_of(elem)?) {
            (Type::Float, _) => bir::Lane::F32x4,
            (Type::Double, _) => bir::Lane::F64x2,
            (_, 1) => bir::Lane::I8x16,
            (_, 2) => bir::Lane::I16x8,
            (_, 4) => bir::Lane::I32x4,
            _ => bir::Lane::I64x2,
        })
    }

    /// The signed integer vector type with the lanes of `ty`: the type of a comparison.
    pub(crate) fn mask_vector_of(&self, ty: &Type) -> Type {
        let Type::Vector(elem, count) = ty else {
            return ty.clone();
        };
        let elem = match self.size_of(elem).unwrap_or(4) {
            1 => Type::SChar,
            2 => Type::Short,
            4 => Type::Int,
            _ => {
                if self.target.long_size() == 8 {
                    Type::Long
                } else {
                    Type::LLong
                }
            }
        };
        Type::Vector(Rc::new(elem), *count)
    }

    pub(crate) fn is_signed(&self, ty: &Type) -> bool {
        match ty {
            Type::Atomic(inner) | Type::Qualified(_, inner) => self.is_signed(inner),
            Type::Char => self.target.char_is_signed(),
            Type::SChar | Type::Short | Type::Int | Type::Long | Type::LLong | Type::Int128 => true,
            _ => false,
        }
    }

    /// Whether values of this integer type are held in an I32 but are narrower than it, so
    /// they need re-normalising after arithmetic.
    pub(crate) fn is_narrow(&self, ty: &Type) -> bool {
        matches!(
            ty.unatomic(),
            Type::Bool | Type::Char | Type::SChar | Type::UChar | Type::Short | Type::UShort
        )
    }

    /// The BIR machine type that holds a value of scalar type `ty`.
    pub(crate) fn machine_ty(&self, ty: &Type) -> bir::Ty {
        match ty {
            Type::Void => bir::Ty::Void,
            Type::Atomic(inner) | Type::Qualified(_, inner) => self.machine_ty(inner),
            Type::Vector(..) => bir::Ty::V128,
            Type::Float => bir::Ty::F32,
            Type::Double => bir::Ty::F64,
            Type::Long | Type::ULong => {
                if self.target.long_size() == 8 {
                    bir::Ty::I64
                } else {
                    bir::Ty::I32
                }
            }
            Type::LLong
            | Type::ULLong
            | Type::Ptr(_)
            | Type::Array(..)
            | Type::Vla(..)
            | Type::Func(_)
            | Type::Struct(_)
            | Type::Int128
            | Type::UInt128
            | Type::ComplexFloat
            | Type::ComplexDouble
            | Type::Wide(_) => bir::Ty::I64,
            _ => bir::Ty::I32,
        }
    }

    /// The memory access kind for loading/storing a scalar of type `ty`.
    pub(crate) fn mem_kind(&self, ty: &Type, for_store: bool) -> bir::MemKind {
        use bir::MemKind;
        match ty {
            Type::Atomic(inner) | Type::Qualified(_, inner) => self.mem_kind(inner, for_store),
            Type::Vector(..) => MemKind::V128,
            Type::Bool | Type::UChar => MemKind::I8U,
            Type::Char | Type::SChar => {
                if self.is_signed(ty) && !for_store {
                    MemKind::I8S
                } else {
                    MemKind::I8U
                }
            }
            Type::Short => {
                if for_store {
                    MemKind::I16U
                } else {
                    MemKind::I16S
                }
            }
            Type::UShort => MemKind::I16U,
            Type::Float => MemKind::F32,
            Type::Double => MemKind::F64,
            other => {
                if self.machine_ty(other) == bir::Ty::I64 {
                    MemKind::I64
                } else {
                    MemKind::I32
                }
            }
        }
    }

    /// Finds `name` in a struct/union, looking through anonymous members. Returns the
    /// member's type and its offset from the start of `id`.
    pub(crate) fn find_member(
        &self,
        id: StructId,
        name: &str,
    ) -> Option<(Type, u64, Option<BitField>)> {
        let def = self.struct_def(id);
        for m in &def.members {
            match &m.name {
                Some(n) if &**n == name => return Some((m.ty.clone(), m.offset, m.bitfield)),
                Some(_) => {}
                None => {
                    if let Type::Struct(inner) = &m.ty {
                        if let Some((ty, off, bits)) = self.find_member(*inner, name) {
                            return Some((ty, m.offset + off, bits));
                        }
                    }
                }
            }
        }
        None
    }

    /// Human-readable spelling for diagnostics.
    pub(crate) fn display(&self, ty: &Type) -> String {
        match ty {
            Type::Void => "void".to_string(),
            Type::Bool => "_Bool".to_string(),
            Type::Char => "char".to_string(),
            Type::SChar => "signed char".to_string(),
            Type::UChar => "unsigned char".to_string(),
            Type::Short => "short".to_string(),
            Type::UShort => "unsigned short".to_string(),
            Type::Int => "int".to_string(),
            Type::UInt => "unsigned int".to_string(),
            Type::Long => "long".to_string(),
            Type::ULong => "unsigned long".to_string(),
            Type::LLong => "long long".to_string(),
            Type::ULLong => "unsigned long long".to_string(),
            Type::Float => "float".to_string(),
            Type::Double => "double".to_string(),
            Type::Int128 => "__int128".to_string(),
            Type::UInt128 => "unsigned __int128".to_string(),
            Type::ComplexFloat => "float _Complex".to_string(),
            Type::ComplexDouble => "double _Complex".to_string(),
            Type::Ptr(t) => format!("{} *", self.display(t)),
            Type::Array(t, Some(n)) => format!("{} [{}]", self.display(t), n),
            Type::Array(t, None) => format!("{} []", self.display(t)),
            Type::Vla(t, _) => format!("{} [*]", self.display(t)),
            Type::Func(f) => {
                let mut s = format!("{} (", self.display(&f.ret));
                for (i, p) in f.params.iter().enumerate() {
                    if i > 0 {
                        s.push_str(", ");
                    }
                    s.push_str(&self.display(p));
                }
                if f.variadic {
                    s.push_str(", ...");
                }
                s.push(')');
                s
            }
            Type::Struct(id) => {
                let def = self.struct_def(*id);
                let kw = if def.is_union { "union" } else { "struct" };
                match &def.tag {
                    Some(tag) => format!("{kw} {tag}"),
                    None => format!("{kw} <anonymous>"),
                }
            }
            Type::Wide(kind) => kind.name().to_string(),
            Type::Vector(elem, count) => {
                format!(
                    "{} __attribute__((vector_size({})))",
                    self.display(elem),
                    self.size_of(ty).unwrap_or(0).max(u64::from(*count))
                )
            }
            Type::Atomic(inner) => format!("_Atomic({})", self.display(inner)),
            Type::Qualified(quals, inner) => {
                let mut text = String::new();
                for (flag, name) in [
                    (Quals::CONST, "const "),
                    (Quals::VOLATILE, "volatile "),
                    (Quals::RESTRICT, "restrict "),
                ] {
                    if quals.has(flag) {
                        text.push_str(name);
                    }
                }
                // `int *const`, but `const int`.
                if matches!(**inner, Type::Ptr(_)) {
                    format!("{} {}", self.display(inner), text.trim_end())
                } else {
                    format!("{text}{}", self.display(inner))
                }
            }
        }
    }
}

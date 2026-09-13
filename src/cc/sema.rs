//! Semantic analysis: scopes, declarations, and construction of typed expressions.
//!
//! The parser calls into this module for every expression it recognises. All of C's
//! implicit conversions are decided here and recorded as explicit nodes: integer
//! promotions, the usual arithmetic conversions, array/function decay, pointer
//! arithmetic scaling, assignment conversions and default argument promotions.

use std::collections::BTreeMap;
use std::rc::Rc;

use crate::ast::*;
use crate::constexpr::{self, Const};
use crate::extended::Extended;
use crate::token::{IntSuffix, Loc, Res, err};
use crate::types::{BitField, FuncType, Member, Quals, StructDef, StructId, Target, Type, TypeCtx};

#[path = "sema_builtin.rs"]
pub(crate) mod builtin;
#[path = "sema_pair.rs"]
mod pair;
#[path = "sema_simd.rs"]
pub(crate) mod simd;
#[path = "sema_vla.rs"]
mod vla;

/// Maximum height of an expression tree. Code generation recurses once per level.
const MAX_EXPR_DEPTH: u32 = 1000;

#[derive(Clone, Debug)]
pub(crate) enum Symbol {
    Local(LocalId),
    Global(GlobalId),
    Func(FuncId),
    Typedef(Type),
    EnumConst(i64, Type),
    /// A parameter seen while its parameter list is still being parsed: its position. In a
    /// function definition that is also the parameter's local variable.
    Param(LocalId, Type),
}

/// One member declaration as parsed, before layout.
pub(crate) struct FieldDecl {
    pub(crate) name: Option<Rc<str>>,
    pub(crate) ty: Type,
    pub(crate) loc: Loc,
    pub(crate) bit_width: Option<u32>,
    /// `aligned(N)` / `_Alignas` on the member.
    pub(crate) align: Option<u64>,
    pub(crate) packed: bool,
}

#[derive(Clone, PartialEq, Debug)]
pub(crate) enum Tag {
    Struct(StructId),
    /// An enumeration and the integer type it is compatible with.
    Enum(Type),
}

pub(crate) struct LabelInfo {
    pub(crate) id: LabelId,
    pub(crate) defined: bool,
    pub(crate) loc: Loc,
}

/// State of the function whose body is being parsed.
pub(crate) struct FnCtx {
    pub(crate) name: Rc<str>,
    pub(crate) ret: Type,
    pub(crate) locals: Vec<LocalVar>,
    pub(crate) labels: BTreeMap<Rc<str>, LabelInfo>,
    pub(crate) nlabels: u32,
    pub(crate) nstatics: u32,
    /// A Microsoft `inline` function: every unit's copy uses the same `static` objects.
    pub(crate) shared_statics: bool,
    /// The function takes `...`.
    pub(crate) variadic: bool,
    /// Labels whose address is taken with `&&`, in order of first mention.
    pub(crate) address_labels: Vec<LabelId>,
    /// For every defined label, the variable length array scopes around it.
    pub(crate) label_vla_paths: BTreeMap<LabelId, Vec<u32>>,
    pub(crate) nvla_scopes: u32,
    /// GNU `__label__` declarations: for every open block that has some, the name each
    /// declared label goes by in `labels`.
    pub(crate) local_labels: Vec<BTreeMap<Rc<str>, Rc<str>>>,
    pub(crate) nlocal_labels: u32,
}

/// What is known about one variable length array type.
pub(crate) struct VlaInfo {
    /// The element count as written; `None` for `[*]`.
    pub(crate) len: Option<Expr>,
    /// The hidden local that holds the evaluated count, once the declaration is reached.
    pub(crate) count: Option<LocalId>,
}

/// How far pointer arithmetic moves per element.
pub(crate) enum Scale {
    Const(u64),
    /// Bytes, as a `long long` expression.
    Dynamic(Expr),
}

pub(crate) struct Sema {
    pub(crate) tcx: TypeCtx,
    scopes: Vec<BTreeMap<Rc<str>, Symbol>>,
    tags: Vec<BTreeMap<Rc<str>, Tag>>,
    pub(crate) globals: Vec<Global>,
    pub(crate) funcs: Vec<Function>,
    pub(crate) strings: Vec<Rc<[u8]>>,
    string_ids: BTreeMap<Rc<[u8]>, StrId>,
    pub(crate) func: Option<FnCtx>,
    /// Indexed by the second field of `Type::Vla`.
    pub(crate) vlas: Vec<VlaInfo>,
    pub(crate) warnings: std::cell::RefCell<Vec<(Loc, String)>>,
    /// Set by `elaborate_init`: where an initialized flexible array member ends, as an
    /// offset into the object (0 if there is none).
    pub(crate) flexible_end: std::cell::Cell<u64>,
    /// Other external names of functions this unit defines: (name, function).
    pub(crate) function_aliases: Vec<(Rc<str>, FuncId)>,
    /// See `Intrinsic::InlineAsm`.
    pub(crate) asm_blocks: Vec<crate::ast::AsmBlock>,
    /// `#pragma weak name`.
    pub(crate) pragma_weak: Vec<(Rc<str>, Loc)>,
    /// `#pragma redefine_extname name symbol`.
    pub(crate) redefined_names: Vec<(Rc<str>, Rc<str>)>,
    /// Functions whose definition is old-style: it gives them a type but no prototype,
    /// so nothing requires an argument to be assignable to its parameter.
    pub(crate) old_style_functions: Vec<FuncId>,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Storage {
    None,
    Static,
    Extern,
}

impl Sema {
    pub(crate) fn new(target: Target) -> Sema {
        let mut sema = Sema::empty(target);
        sema.declare_builtin_types();
        sema
    }

    /// `__builtin_va_list` (whose shape is the target's calling convention) and the 128-bit
    /// integer typedef names.
    fn declare_builtin_types(&mut self) {
        use crate::types::{Arch, Os};
        let none = Loc::default();
        let field = |name: &str, ty: Type| FieldDecl {
            name: Some(Rc::from(name)),
            ty,
            loc: none,
            bit_width: None,
            align: None,
            packed: false,
        };
        let void_ptr = Type::Void.ptr_to();
        let target = self.tcx.target;
        let va_list = match (target.arch, target.os) {
            (_, Os::Windows) | (Arch::Aarch64, Os::MacOs) => Type::Char.ptr_to(),
            (Arch::X86_64, _) => {
                let id = self.new_struct(Some(Rc::from("__va_list_tag")), false);
                let fields = vec![
                    field("gp_offset", Type::UInt),
                    field("fp_offset", Type::UInt),
                    field("overflow_arg_area", void_ptr.clone()),
                    field("reg_save_area", void_ptr),
                ];
                let _ = self.complete_struct(id, fields, false, None, None, false, none);
                Type::Array(Rc::new(Type::Struct(id)), Some(1))
            }
            (Arch::Aarch64, _) => {
                let id = self.new_struct(Some(Rc::from("__va_list")), false);
                let fields = vec![
                    field("__stack", void_ptr.clone()),
                    field("__gr_top", void_ptr.clone()),
                    field("__vr_top", void_ptr),
                    field("__gr_offs", Type::Int),
                    field("__vr_offs", Type::Int),
                ];
                let _ = self.complete_struct(id, fields, false, None, None, false, none);
                Type::Struct(id)
            }
        };
        self.bind(Rc::from("__builtin_va_list"), Symbol::Typedef(va_list));
        self.bind(Rc::from("__int128_t"), Symbol::Typedef(Type::Int128));
        self.bind(Rc::from("__uint128_t"), Symbol::Typedef(Type::UInt128));
        // The interchange and extended floating types of C23 Annex H, which glibc's headers
        // use as keywords when the compiler says it is GCC 7 or later.
        let long_double = self.tcx.target.long_double_type();
        for (name, ty) in [
            ("_Float32", Type::Float),
            ("_Float64", Type::Double),
            ("_Float32x", Type::Double),
            ("_Float64x", long_double),
            ("_Float128", Type::Wide(crate::types::WideKind::Float128)),
            ("__float128", Type::Wide(crate::types::WideKind::Float128)),
            ("_Float16", Type::Wide(crate::types::WideKind::Float16)),
            ("__fp16", Type::Wide(crate::types::WideKind::Float16)),
        ] {
            self.bind(Rc::from(name), Symbol::Typedef(ty));
        }
    }

    fn empty(target: Target) -> Sema {
        Sema {
            tcx: TypeCtx::new(target),
            scopes: vec![BTreeMap::new()],
            tags: vec![BTreeMap::new()],
            globals: Vec::new(),
            funcs: Vec::new(),
            strings: Vec::new(),
            string_ids: BTreeMap::new(),
            func: None,
            vlas: Vec::new(),
            warnings: std::cell::RefCell::new(Vec::new()),
            flexible_end: std::cell::Cell::new(0),
            function_aliases: Vec::new(),
            asm_blocks: Vec::new(),
            pragma_weak: Vec::new(),
            redefined_names: Vec::new(),
            old_style_functions: Vec::new(),
        }
    }

    // ───────────────────────────── scopes ─────────────────────────────

    pub(crate) fn push_scope(&mut self) {
        self.scopes.push(BTreeMap::new());
        self.tags.push(BTreeMap::new());
    }

    pub(crate) fn pop_scope(&mut self) {
        if self.scopes.len() > 1 {
            self.scopes.pop();
            self.tags.pop();
        }
    }

    pub(crate) fn at_file_scope(&self) -> bool {
        self.scopes.len() == 1
    }

    pub(crate) fn lookup(&self, name: &str) -> Option<&Symbol> {
        self.scopes.iter().rev().find_map(|s| s.get(name))
    }

    fn lookup_current_scope(&self, name: &str) -> Option<&Symbol> {
        self.scopes.last().and_then(|s| s.get(name))
    }

    pub(crate) fn is_typedef_name(&self, name: &str) -> bool {
        matches!(self.lookup(name), Some(Symbol::Typedef(_)))
    }

    fn bind(&mut self, name: Rc<str>, sym: Symbol) {
        if let Some(scope) = self.scopes.last_mut() {
            scope.insert(name, sym);
        }
    }

    pub(crate) fn bind_param(&mut self, name: Rc<str>, index: LocalId, ty: Type) {
        self.bind(name, Symbol::Param(index, ty));
    }

    pub(crate) fn lookup_tag(&self, name: &str) -> Option<Tag> {
        self.tags.iter().rev().find_map(|s| s.get(name).cloned())
    }

    pub(crate) fn lookup_tag_current_scope(&self, name: &str) -> Option<Tag> {
        self.tags.last().and_then(|s| s.get(name).cloned())
    }

    pub(crate) fn bind_tag(&mut self, name: Rc<str>, tag: Tag) {
        if let Some(scope) = self.tags.last_mut() {
            scope.insert(name, tag);
        }
    }

    // ───────────────────────────── types ─────────────────────────────

    /// How far the flexible array member that the last `elaborate_init` initialized reaches
    /// past the end of an object of type `ty`.
    pub(crate) fn flexible_extra(&self, ty: &Type) -> u64 {
        self.flexible_end
            .get()
            .saturating_sub(self.tcx.size_of(ty).unwrap_or(0))
    }

    pub(crate) fn size_type(&self) -> Type {
        if self.tcx.target.long_size() == 8 {
            Type::ULong
        } else {
            Type::ULLong
        }
    }

    pub(crate) fn ptrdiff_type(&self) -> Type {
        if self.tcx.target.long_size() == 8 {
            Type::Long
        } else {
            Type::LLong
        }
    }

    pub(crate) fn new_struct(&mut self, tag: Option<Rc<str>>, is_union: bool) -> StructId {
        self.tcx.structs.push(StructDef {
            tag,
            is_union,
            complete: false,
            members: Vec::new(),
            size: 0,
            align: 1,
            transparent: false,
        });
        (self.tcx.structs.len() - 1) as StructId
    }

    /// Lays out the members of a struct/union and marks it complete. Bit-fields follow the
    /// System V / Itanium rules GCC uses on the LP64 targets, or Microsoft's when
    /// `ms_bitfields`: a bit-field lives in a whole object of its declared type, which it
    /// shares only with neighbours whose types have that size.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn complete_struct(
        &mut self,
        id: StructId,
        fields: Vec<FieldDecl>,
        packed: bool,
        min_align: Option<u64>,
        pragma_pack: Option<u64>,
        ms_bitfields: bool,
        loc: Loc,
    ) -> Res<()> {
        let is_union = self.tcx.struct_def(id).is_union;
        let mut members: Vec<Member> = Vec::with_capacity(fields.len());
        // Everything is tracked in bits so bit-fields and ordinary members share one cursor.
        let mut bit_pos: u64 = 0;
        let mut size_bits: u64 = 0;
        let mut align: u64 = 1;
        // Microsoft layout: the bits of the storage unit the last bit-field is in (0 after
        // anything else) and how many of them are free.
        let (mut unit_bits, mut unit_free): (u64, u64) = (0, 0);
        // Clang has two implementations of the Microsoft rules, which part ways on attributes
        // and in unions: the one for Windows targets, and `ms_struct` on the others.
        let windows = self.tcx.target.os == crate::types::Os::Windows;
        let nfields = fields.len();
        for (i, field) in fields.into_iter().enumerate() {
            let FieldDecl {
                name,
                ty,
                loc,
                bit_width,
                align: field_align,
                packed: field_packed,
            } = field;
            // `T a[];` closes a struct; GNU C also takes it in a union and on its own.
            let is_flexible = matches!(ty, Type::Array(_, None))
                && (i + 1 == nfields || is_union)
                && bit_width.is_none();
            let (fsize, natural_align) = if is_flexible {
                (0, self.tcx.align_of(&ty).unwrap_or(1))
            } else {
                match (self.tcx.size_of(&ty), self.tcx.align_of(&ty)) {
                    (Some(s), Some(a)) => (s, a),
                    _ => {
                        return err(
                            loc,
                            format!("member has incomplete type '{}'", self.tcx.display(&ty)),
                        );
                    }
                }
            };
            if let Some(n) = &name {
                let clash = members.iter().any(|m| m.name.as_deref() == Some(&**n));
                if clash {
                    return err(loc, format!("duplicate member '{n}'"));
                }
            }
            // The System V rules as GCC implements them. `packed` and `#pragma pack` put
            // bit-fields next to each other whatever their type; a zero-width bit-field is
            // affected by neither.
            let zero_width = bit_width == Some(0);
            let requested = field_align.unwrap_or(0);
            let mut falign = natural_align;
            let mut bits_packed = false;
            // An `aligned` bit-field starts a unit of its own even where `#pragma pack`
            // cancels the alignment itself.
            let starts_unit = field_align.is_some();
            let mut field_align = field_align;
            if !zero_width {
                if packed || field_packed {
                    falign = 1;
                    bits_packed = true;
                }
                if let Some(limit) = pragma_pack {
                    bits_packed = true;
                    falign = falign.min(limit);
                    // (Microsoft lets an alignment written on the member win.)
                    if field_align.is_some_and(|a| limit < a) && !windows {
                        field_align = None;
                    }
                }
                if let Some(a) = field_align {
                    // `aligned` only ever raises the alignment, unless the member is packed.
                    falign = if packed || field_packed {
                        a
                    } else {
                        falign.max(a)
                    };
                }
            }
            if is_union {
                bit_pos = 0;
            }
            if let (Some(width), true) = (bit_width, ms_bitfields) {
                let width = u64::from(width);
                let type_bits = fsize * 8;
                if width > type_bits {
                    return err(loc, "width of bit-field exceeds its type");
                }
                // The alignment of the storage unit.
                let mut unit_align = if windows {
                    let limit = if packed { Some(1) } else { pragma_pack };
                    let mut a = natural_align.max(requested);
                    if let Some(limit) = limit {
                        a = a.min(limit);
                    }
                    if field_packed {
                        a = 1;
                    }
                    a.max(requested)
                } else {
                    // `packed` means something here only together with `#pragma pack`.
                    let mut a = fsize.max(requested);
                    if let (Some(limit), true) = (pragma_pack, width != 0) {
                        a = if packed || field_packed {
                            fsize.min(limit)
                        } else {
                            a.min(limit)
                        };
                    }
                    a
                };
                let fits = unit_bits == type_bits && width <= unit_free;
                if is_union {
                    // The whole unit at offset 0; its alignment is not the union's.
                    let occupied = if width != 0 {
                        type_bits
                    } else if windows {
                        if unit_bits != 0 { type_bits } else { 0 }
                    } else {
                        8
                    };
                    size_bits = size_bits.max(occupied);
                    unit_bits = if width != 0 { type_bits } else { 0 };
                    unit_free = 0;
                    if let (true, Some(_)) = (width != 0, &name) {
                        members.push(Member {
                            name,
                            ty,
                            offset: 0,
                            bitfield: Some(BitField {
                                bit_offset: 0,
                                width: width as u32,
                                readable: 0,
                            }),
                        });
                    }
                    continue;
                }
                if width == 0 {
                    // It ends the unit of the bit-field before it, and is nothing anywhere else.
                    if unit_bits != 0 {
                        // (Where `#pragma pack` has misaligned the unit, Microsoft aligns its
                        // end, and so does Clang's `ms_struct` unless the zero-width field has
                        // the unit's size: then it aligns the next free bit.)
                        let from = if windows || unit_bits != type_bits {
                            bit_pos
                        } else {
                            bit_pos - unit_free
                        };
                        bit_pos = bit_pos.max(from.next_multiple_of(unit_align * 8));
                        size_bits = size_bits.max(bit_pos);
                        align = align.max(unit_align);
                    }
                    (unit_bits, unit_free) = (0, 0);
                    continue;
                }
                if !fits {
                    let start = (bit_pos / 8).next_multiple_of(unit_align);
                    if start.checked_add(fsize).is_none_or(|end| end >= (1 << 40)) {
                        return err(loc, "struct is too large");
                    }
                    bit_pos = (start + fsize) * 8;
                    size_bits = size_bits.max(bit_pos);
                    (unit_bits, unit_free) = (type_bits, type_bits);
                } else if windows {
                    // A field that joins a unit does not add to the alignment there.
                    unit_align = 1;
                }
                align = align.max(unit_align);
                let at = bit_pos - unit_free;
                unit_free -= width;
                if name.is_some() {
                    members.push(Member {
                        name,
                        ty,
                        offset: at / 8,
                        bitfield: Some(BitField {
                            bit_offset: (at % 8) as u32,
                            width: width as u32,
                            readable: 0,
                        }),
                    });
                }
                continue;
            }
            (unit_bits, unit_free) = (0, 0);
            if let Some(width) = bit_width {
                let unit_bits = fsize * 8;
                if u64::from(width) > unit_bits {
                    return err(loc, "width of bit-field exceeds its type");
                }
                if width == 0 {
                    // An unnamed zero-width bit-field ends the current storage unit.
                    bit_pos = bit_pos.next_multiple_of(natural_align * 8);
                    continue;
                }
                let width = u64::from(width);
                if starts_unit {
                    // An aligned bit-field starts a storage unit of its own.
                    bit_pos = bit_pos.div_ceil(8).next_multiple_of(falign) * 8;
                } else if !bits_packed {
                    // It may not span more units of its type than the type has.
                    let unit = falign * 8;
                    let spanned = ((bit_pos % unit) + width).div_ceil(unit);
                    if spanned > fsize / falign {
                        bit_pos = bit_pos.div_ceil(8).next_multiple_of(falign) * 8;
                    }
                }
                if name.is_some() {
                    align = align.max(falign);
                    members.push(Member {
                        name,
                        ty,
                        offset: bit_pos / 8,
                        bitfield: Some(BitField {
                            bit_offset: (bit_pos % 8) as u32,
                            width: width as u32,
                            readable: 0,
                        }),
                    });
                }
                bit_pos += width;
                size_bits = size_bits.max(bit_pos);
                continue;
            }
            align = align.max(falign);
            let field_offset = bit_pos.div_ceil(8).next_multiple_of(falign);
            let end = match field_offset.checked_add(fsize) {
                Some(end) if end < (1 << 40) => end,
                _ => return err(loc, "struct is too large"),
            };
            bit_pos = end * 8;
            size_bits = size_bits.max(bit_pos);
            members.push(Member {
                name,
                ty,
                offset: field_offset,
                bitfield: None,
            });
        }
        if let Some(a) = min_align {
            if !a.is_power_of_two() {
                return err(loc, "requested alignment is not a power of two");
            }
            align = align.max(a);
        }
        let mut size = size_bits.div_ceil(8).next_multiple_of(align);
        // Microsoft C has no object of size zero: a structure with no members, or with nothing
        // but flexible arrays, has four bytes (or its alignment, where that was asked for).
        if size == 0 && windows && ms_bitfields {
            size = if min_align.is_some_and(|a| a >= 4) {
                align
            } else {
                4
            };
        }
        for member in &mut members {
            if let Some(field) = &mut member.bitfield {
                let window = field.bytes().next_power_of_two();
                if window <= 8 && member.offset + window <= size {
                    field.readable = window as u32;
                }
            }
        }
        let def = &mut self.tcx.structs[id as usize];
        def.members = members;
        def.align = align;
        def.size = size;
        def.complete = true;
        Ok(())
    }

    // ───────────────────────────── declarations ─────────────────────────────

    pub(crate) fn declare_typedef(&mut self, name: Rc<str>, ty: Type, loc: Loc) -> Res<()> {
        match self.lookup_current_scope(&name) {
            Some(Symbol::Typedef(old)) if *old == ty => Ok(()),
            // The same type with an alignment given by only one of the declarations: it
            // is that of the one that gives it.
            Some(Symbol::Typedef(old)) if old.without_alignment() == ty.without_alignment() => {
                if ty.alignment().is_some() {
                    self.bind(name, Symbol::Typedef(ty));
                }
                Ok(())
            }
            Some(_) => err(loc, format!("redefinition of '{name}'")),
            None => {
                self.bind(name, Symbol::Typedef(ty));
                Ok(())
            }
        }
    }

    /// `unsigned` says the value came from an unsigned expression. Enumerators are `int`
    /// when they fit; larger ones take the narrowest of unsigned int, long, unsigned long
    /// (a GNU extension that system headers use, e.g. `EPOLLET = 1u << 31`).
    pub(crate) fn declare_enum_const(
        &mut self,
        name: Rc<str>,
        value: i64,
        unsigned: bool,
        loc: Loc,
    ) -> Res<()> {
        if self.lookup_current_scope(&name).is_some() {
            return err(loc, format!("redefinition of '{name}'"));
        }
        let ty = if i32::try_from(value).is_ok() {
            Type::Int
        } else if u32::try_from(value).is_ok() {
            Type::UInt
        } else if unsigned && value < 0 {
            Type::ULLong
        } else {
            Type::LLong
        };
        self.bind(name, Symbol::EnumConst(value, ty));
        Ok(())
    }

    pub(crate) fn declare_local(&mut self, name: Rc<str>, ty: Type, loc: Loc) -> Res<LocalId> {
        if self.lookup_current_scope(&name).is_some() {
            return err(loc, format!("redefinition of '{name}'"));
        }
        if !self.tcx.is_complete(&ty) {
            return err(
                loc,
                format!(
                    "variable '{name}' has incomplete type '{}'",
                    self.tcx.display(&ty)
                ),
            );
        }
        let id = self.new_local(ty);
        self.bind(name, Symbol::Local(id));
        Ok(id)
    }

    /// A local with no name in scope (parameters of unnamed parameters never reach here).
    pub(crate) fn new_local(&mut self, ty: Type) -> LocalId {
        match &mut self.func {
            Some(f) => {
                // Atomic operations need the object's address.
                let addr_taken = ty.is_atomic();
                let volatile = ty.is_volatile();
                f.locals.push(LocalVar {
                    ty,
                    align: None,
                    addr_taken,
                    addr_count: u32::from(addr_taken),
                    punned_count: 0,
                    volatile,
                });
                (f.locals.len() - 1) as LocalId
            }
            None => 0,
        }
    }

    pub(crate) fn set_local_align(&mut self, id: LocalId, align: u64) {
        if let Some(local) = self
            .func
            .as_mut()
            .and_then(|f| f.locals.get_mut(id as usize))
        {
            local.align = Some(local.align.unwrap_or(1).max(align));
        }
    }

    /// Completes the type of a local declared as `T x[] = {...}` once the initializer is known.
    pub(crate) fn set_local_type(&mut self, id: LocalId, ty: Type) {
        if let Some(local) = self
            .func
            .as_mut()
            .and_then(|f| f.locals.get_mut(id as usize))
        {
            local.ty = ty;
        }
    }

    fn compatible_object_types(old: &Type, new: &Type) -> bool {
        match (old, new) {
            (Type::Array(a, la), Type::Array(b, lb)) => {
                Self::compatible_object_types(a, b) && (la.is_none() || lb.is_none() || la == lb)
            }
            _ => Self::compatible(old, new),
        }
    }

    /// Declares or redeclares a variable with static storage duration that is visible by
    /// name at file scope (`int x;`, `static int x = 1;`, `extern int x;`).
    pub(crate) fn declare_global(
        &mut self,
        name: Rc<str>,
        ty: Type,
        is_definition: bool,
        loc: Loc,
    ) -> Res<GlobalId> {
        let existing = self.scopes[0].get(&name).cloned();
        let id = match existing {
            Some(Symbol::Global(id)) => {
                let g = &mut self.globals[id as usize];
                if !Self::compatible_object_types(&g.ty, &ty) {
                    return err(loc, format!("conflicting types for '{name}'"));
                }
                if matches!(g.ty, Type::Array(_, None)) {
                    g.ty = ty;
                }
                g.defined |= is_definition;
                id
            }
            Some(_) => {
                return err(
                    loc,
                    format!("'{name}' redeclared as a different kind of symbol"),
                );
            }
            None => {
                self.globals.push(Global {
                    name: Rc::clone(&name),
                    ty,
                    defined: is_definition,
                    init: Vec::new(),
                    relocs: Vec::new(),
                    has_initializer: false,
                    align: None,
                    link_name: None,
                    is_static: false,
                    thread_local: false,
                    extra_size: 0,
                    weak: false,
                    linkonce: false,
                });
                let id = (self.globals.len() - 1) as GlobalId;
                self.scopes[0].insert(Rc::clone(&name), Symbol::Global(id));
                id
            }
        };
        if !self.at_file_scope() {
            // A block-scope `extern` declaration makes the file-scope entity visible here.
            self.bind(name, Symbol::Global(id));
        }
        Ok(id)
    }

    pub(crate) fn is_file_scope_object(&self, name: &str) -> bool {
        matches!(self.scopes[0].get(name), Some(Symbol::Global(_)))
    }

    /// Records whether a declaration of global `id` said `_Thread_local`; every declaration
    /// of one object has to agree.
    pub(crate) fn set_thread_local(
        &mut self,
        id: GlobalId,
        thread_local: bool,
        first: bool,
        loc: Loc,
    ) -> Res<()> {
        let g = &mut self.globals[id as usize];
        if !first && g.thread_local != thread_local {
            return err(
                loc,
                format!(
                    "'{}' is thread-local in one declaration and not in another",
                    g.name
                ),
            );
        }
        g.thread_local = thread_local;
        Ok(())
    }

    pub(crate) fn set_global_attrs(
        &mut self,
        id: GlobalId,
        align: Option<u64>,
        link_name: Option<Rc<str>>,
    ) {
        let g = &mut self.globals[id as usize];
        if let Some(a) = align {
            g.align = Some(g.align.unwrap_or(1).max(a));
        }
        if link_name.is_some() {
            g.link_name = link_name;
        }
    }

    /// A `static` variable declared inside a function body.
    pub(crate) fn declare_static_local(
        &mut self,
        name: Rc<str>,
        ty: Type,
        loc: Loc,
    ) -> Res<GlobalId> {
        if self.lookup_current_scope(&name).is_some() {
            return err(loc, format!("redefinition of '{name}'"));
        }
        let mangled: Rc<str> = match &mut self.func {
            Some(f) => {
                f.nstatics += 1;
                Rc::from(format!("{}.{}.{}", f.name, name, f.nstatics))
            }
            None => Rc::clone(&name),
        };
        self.globals.push(Global {
            name: mangled,
            ty,
            defined: true,
            init: Vec::new(),
            relocs: Vec::new(),
            has_initializer: false,
            align: None,
            link_name: None,
            is_static: true,
            thread_local: false,
            extra_size: 0,
            weak: false,
            linkonce: self.func.as_ref().is_some_and(|f| f.shared_statics),
        });
        let id = (self.globals.len() - 1) as GlobalId;
        self.bind(name, Symbol::Global(id));
        Ok(id)
    }

    pub(crate) fn declare_func(
        &mut self,
        name: Rc<str>,
        fty: Rc<FuncType>,
        is_static: bool,
        loc: Loc,
    ) -> Res<FuncId> {
        let existing = self.scopes[0].get(&name).cloned();
        let id = match existing {
            Some(Symbol::Func(id)) => {
                let f = &mut self.funcs[id as usize];
                let compatible =
                    Self::compatible(&Type::Func(Rc::clone(&f.ty)), &Type::Func(Rc::clone(&fty)));
                if !compatible {
                    return err(loc, format!("conflicting types for '{name}'"));
                }
                if f.ty.unprototyped || f.body.is_none() {
                    if !fty.unprototyped || f.ty.unprototyped {
                        f.ty = fty;
                    }
                }
                f.is_static |= is_static;
                id
            }
            Some(_) => {
                return err(
                    loc,
                    format!("'{name}' redeclared as a different kind of symbol"),
                );
            }
            None => {
                self.funcs.push(Function {
                    name: Rc::clone(&name),
                    ty: fty,
                    is_static,
                    external: false,
                    linkonce: false,
                    link_name: None,
                    inlining: 0,
                    constructor: None,
                    destructor: None,
                    weak: None,
                    param_names: Vec::new(),
                    body: None,
                    first_use: None,
                    loc,
                });
                let id = (self.funcs.len() - 1) as FuncId;
                self.scopes[0].insert(Rc::clone(&name), Symbol::Func(id));
                id
            }
        };
        if !self.at_file_scope() {
            self.bind(name, Symbol::Func(id));
        }
        Ok(id)
    }

    pub(crate) fn file_scope_function(&self, name: &str) -> Option<FuncId> {
        match self.scopes[0].get(name) {
            Some(Symbol::Func(id)) => Some(*id),
            _ => None,
        }
    }

    pub(crate) fn file_scope_object(&self, name: &str) -> Option<GlobalId> {
        match self.scopes[0].get(name) {
            Some(Symbol::Global(id)) => Some(*id),
            _ => None,
        }
    }

    /// Makes `name` another name for function `target`.
    pub(crate) fn alias_function(&mut self, name: Rc<str>, target: FuncId, is_static: bool) {
        self.scopes[0].insert(Rc::clone(&name), Symbol::Func(target));
        if !self.at_file_scope() {
            self.bind(Rc::clone(&name), Symbol::Func(target));
        }
        if !is_static && !self.function_aliases.iter().any(|(n, _)| *n == name) {
            self.function_aliases.push((name, target));
        }
    }

    /// Makes `name` another name for the file-scope object `target`. Only this unit sees it.
    pub(crate) fn alias_object(&mut self, name: Rc<str>, target: GlobalId) {
        self.scopes[0].insert(Rc::clone(&name), Symbol::Global(target));
        if !self.at_file_scope() {
            self.bind(name, Symbol::Global(target));
        }
    }

    pub(crate) fn intern_string(&mut self, bytes: Vec<u8>) -> StrId {
        let key: Rc<[u8]> = Rc::from(bytes);
        if let Some(&id) = self.string_ids.get(&key) {
            return id;
        }
        let id = self.strings.len() as StrId;
        self.strings.push(Rc::clone(&key));
        self.string_ids.insert(key, id);
        id
    }

    // ───────────────────────────── labels ─────────────────────────────

    pub(crate) fn new_label(&mut self) -> LabelId {
        match &mut self.func {
            Some(f) => {
                f.nlabels += 1;
                f.nlabels - 1
            }
            None => 0,
        }
    }

    /// Looks up (creating on first mention) the named label.
    pub(crate) fn named_label(&mut self, name: &Rc<str>, defining: bool, loc: Loc) -> Res<LabelId> {
        let Some(f) = &mut self.func else {
            return err(loc, "label outside of a function");
        };
        let local = f
            .local_labels
            .iter()
            .rev()
            .find_map(|scope| scope.get(name));
        let name = &local.map_or_else(|| Rc::clone(name), Rc::clone);
        if let Some(info) = f.labels.get_mut(name) {
            if defining {
                if info.defined {
                    return err(loc, format!("redefinition of label '{name}'"));
                }
                info.defined = true;
            }
            return Ok(info.id);
        }
        let id = f.nlabels;
        f.nlabels += 1;
        f.labels.insert(
            Rc::clone(name),
            LabelInfo {
                id,
                defined: defining,
                loc,
            },
        );
        Ok(id)
    }

    /// `__label__ name;`: `name` is a label of the block being opened only.
    pub(crate) fn declare_local_label(
        &mut self,
        name: &Rc<str>,
        scope: usize,
        loc: Loc,
    ) -> Res<()> {
        let Some(f) = &mut self.func else {
            return err(loc, "label outside of a function");
        };
        f.nlocal_labels += 1;
        let unique: Rc<str> = Rc::from(format!("{name}.{}", f.nlocal_labels));
        match f.local_labels.get_mut(scope) {
            Some(names) => {
                names.insert(Rc::clone(name), unique);
                Ok(())
            }
            None => err(loc, "internal error: no block for a local label"),
        }
    }

    // ───────────────────────────── expression construction ─────────────────────────────

    pub(crate) fn mk(&self, kind: ExprKind, ty: Type, loc: Loc) -> Res<Expr> {
        if ty.is_vector() && !matches!(self.tcx.size_of(&ty), Some(8 | 16)) {
            return err(loc, simd::VECTOR_SIZES);
        }
        let mut e = Expr {
            kind,
            ty,
            loc,
            has_control_flow: false,
            depth: 1,
        };
        let mut cf = matches!(
            e.kind,
            ExprKind::LogAnd(..) | ExprKind::LogOr(..) | ExprKind::Cond(..)
        );
        let mut depth = 0;
        e.for_each_child(|c| {
            cf |= c.has_control_flow;
            depth = depth.max(c.depth);
        });
        e.has_control_flow = cf;
        e.depth = depth + 1;
        if e.depth > MAX_EXPR_DEPTH {
            return err(loc, "expression is nested too deeply");
        }
        Ok(e)
    }

    /// Wraps `value` to the width and signedness of integer/pointer type `ty`.
    pub(crate) fn wrap_int(&self, value: i64, ty: &Type) -> i64 {
        constexpr::wrap(value, ty, &self.tcx)
    }

    pub(crate) fn int_lit(&self, value: i64, ty: Type, loc: Loc) -> Res<Expr> {
        let value = self.wrap_int(value, &ty);
        self.mk(ExprKind::IntLit(value), ty, loc)
    }

    /// Types an integer constant per C11 6.4.4.1.
    pub(crate) fn int_constant(
        &self,
        value: u64,
        decimal: bool,
        suffix: IntSuffix,
        loc: Loc,
    ) -> Res<Expr> {
        let candidates: &[Type] = match (suffix.unsigned, suffix.longs, decimal) {
            (false, 0, true) => &[Type::Int, Type::Long, Type::LLong],
            (false, 0, false) => &[
                Type::Int,
                Type::UInt,
                Type::Long,
                Type::ULong,
                Type::LLong,
                Type::ULLong,
            ],
            (true, 0, _) => &[Type::UInt, Type::ULong, Type::ULLong],
            (false, 1, true) => &[Type::Long, Type::LLong],
            (false, 1, false) => &[Type::Long, Type::ULong, Type::LLong, Type::ULLong],
            (true, 1, _) => &[Type::ULong, Type::ULLong],
            (false, _, true) => &[Type::LLong],
            (false, _, false) => &[Type::LLong, Type::ULLong],
            (true, _, _) => &[Type::ULLong],
        };
        for ty in candidates {
            let bits = self.tcx.size_of(ty).unwrap_or(8) * 8;
            let value_bits = if self.tcx.is_signed(ty) {
                bits - 1
            } else {
                bits
            };
            if value_bits >= 64 || value >> value_bits == 0 {
                return self.int_lit(value as i64, ty.clone(), loc);
            }
        }
        // A decimal constant too big for long long: GCC and Clang make it unsigned.
        self.int_lit(value as i64, Type::ULLong, loc)
    }

    pub(crate) fn float_lit(&self, value: f64, ty: Type, loc: Loc) -> Res<Expr> {
        self.mk(ExprKind::FloatLit(value), ty, loc)
    }

    /// A narrow string literal; `bytes` excludes the terminator.
    pub(crate) fn long_double_lit(&self, value: Extended, loc: Loc) -> Res<Expr> {
        self.mk(
            ExprKind::LongDoubleLit(value),
            Type::Wide(crate::types::WideKind::LongDouble),
            loc,
        )
    }

    /// A comparison of two `long double` values: the operation that answers it takes the two
    /// objects and gives an `int`.
    fn long_double_compare(&self, op: BinOp, a: Expr, b: Expr, loc: Loc) -> Res<Expr> {
        use crate::x87::X87Op;
        if let (ExprKind::LongDoubleLit(x), ExprKind::LongDoubleLit(y)) = (&a.kind, &b.kind) {
            return self.int_lit(
                i64::from(constexpr::long_double_compare(op, *x, *y)),
                Type::Int,
                loc,
            );
        }
        let (operation, operands, negated) = match op {
            BinOp::Lt => (X87Op::Less, vec![a, b], false),
            BinOp::Gt => (X87Op::Less, vec![b, a], false),
            BinOp::Le => (X87Op::LessEq, vec![a, b], false),
            BinOp::Ge => (X87Op::LessEq, vec![b, a], false),
            BinOp::Ne => (X87Op::Equal, vec![a, b], true),
            _ => (X87Op::Equal, vec![a, b], false),
        };
        let compared = self.mk(
            ExprKind::Intrinsic(Intrinsic::X87(operation), operands),
            Type::Int,
            loc,
        )?;
        if negated {
            return self.mk(ExprKind::LogNot(Box::new(compared)), Type::Int, loc);
        }
        Ok(compared)
    }

    pub(crate) fn string_lit(&mut self, mut bytes: Vec<u8>, loc: Loc) -> Res<Expr> {
        bytes.push(0);
        let len = bytes.len() as u64;
        let id = self.intern_string(bytes);
        self.mk(
            ExprKind::StrLit(id),
            Type::Array(Rc::new(Type::Char), Some(len)),
            loc,
        )
    }

    /// The element type of `L""`, `u""` and `U""` literals.
    pub(crate) fn wide_elem_type(&self, kind: crate::token::WideKind) -> Type {
        use crate::token::WideKind;
        match kind {
            WideKind::Wchar if self.tcx.target.os == crate::types::Os::Windows => Type::UShort,
            WideKind::Wchar => Type::Int,
            WideKind::Char16 => Type::UShort,
            WideKind::Char32 => Type::UInt,
        }
    }

    /// A wide string literal from code points; 16-bit element types get UTF-16.
    pub(crate) fn wide_string_lit(&mut self, points: &[u32], elem: Type, loc: Loc) -> Res<Expr> {
        let esize = self.tcx.size_of(&elem).unwrap_or(4);
        let mut bytes = Vec::with_capacity((points.len() + 1) * esize as usize);
        let mut count: u64 = 1;
        for &p in points {
            if esize == 2 && p > 0xffff && p <= 0x10_ffff {
                let v = p - 0x1_0000;
                bytes.extend_from_slice(&(0xd800 + (v >> 10) as u16).to_le_bytes());
                bytes.extend_from_slice(&(0xdc00 + (v & 0x3ff) as u16).to_le_bytes());
                count += 2;
            } else {
                bytes.extend_from_slice(&p.to_le_bytes()[..esize as usize]);
                count += 1;
            }
        }
        bytes.extend(std::iter::repeat_n(0u8, esize as usize));
        let id = self.intern_string(bytes);
        self.mk(
            ExprKind::StrLit(id),
            Type::Array(Rc::new(elem), Some(count)),
            loc,
        )
    }

    pub(crate) fn ident(&mut self, name: &str, loc: Loc) -> Res<Expr> {
        let Some(sym) = self.lookup(name).cloned() else {
            if matches!(
                name,
                "__func__"
                    | "__FUNCTION__"
                    | "__PRETTY_FUNCTION__"
                    | "__FUNCSIG__"
                    | "__FUNCDNAME__"
            ) {
                if let Some(f) = &self.func {
                    let bytes = f.name.as_bytes().to_vec();
                    return self.string_lit(bytes, loc);
                }
            }
            if name.starts_with("__builtin_va_")
                || matches!(name, "va_start" | "va_arg" | "va_end" | "va_copy")
            {
                return err(
                    loc,
                    "variadic function definitions (va_list, va_start, va_arg) are not supported yet",
                );
            }
            return err(loc, format!("use of undeclared identifier '{name}'"));
        };
        match sym {
            Symbol::Local(id) => {
                let ty = match &self.func {
                    Some(f) => f.locals[id as usize].ty.clone(),
                    None => return err(loc, "local variable used outside of a function"),
                };
                self.mk(ExprKind::Local(id), ty, loc)
            }
            Symbol::Global(id) => {
                let ty = self.globals[id as usize].ty.clone();
                self.mk(ExprKind::Global(id), ty, loc)
            }
            Symbol::Func(id) => {
                let f = &mut self.funcs[id as usize];
                f.first_use.get_or_insert(loc);
                let ty = Type::Func(Rc::clone(&f.ty));
                self.mk(ExprKind::Func(id), ty, loc)
            }
            Symbol::EnumConst(v, ty) => self.int_lit(v, ty, loc),
            Symbol::Param(index, ty) => self.mk(ExprKind::Local(index), ty, loc),
            Symbol::Typedef(_) => err(
                loc,
                format!("unexpected type name '{name}': expected expression"),
            ),
        }
    }

    /// Array-to-pointer and function-to-pointer conversion (C11 6.3.2.1).
    pub(crate) fn rvalue(&self, e: Expr) -> Res<Expr> {
        let loc = e.loc;
        match &e.ty {
            Type::Array(elem, _) | Type::Vla(elem, _) => {
                let ty = Type::Ptr(Rc::clone(elem));
                self.mk(ExprKind::Decay(Box::new(e)), ty, loc)
            }
            Type::Func(_) => {
                let ty = e.ty.clone().ptr_to();
                self.mk(ExprKind::Decay(Box::new(e)), ty, loc)
            }
            Type::Atomic(_) => self.atomic_read(e),
            // Lvalue conversion drops the qualifiers. (A volatile load happens where the
            // lvalue is evaluated.)
            Type::Qualified(_, inner) => {
                let inner = (**inner).clone();
                let promotes = match &e.kind {
                    ExprKind::BitField { field, .. } => {
                        !inner.is_int128()
                            && (field.width < 32
                                || (field.width == 32 && self.tcx.is_signed(&inner)))
                            && inner != Type::Int
                    }
                    _ => false,
                };
                let value = self.mk(ExprKind::Cast(Box::new(e)), inner, loc)?;
                if promotes {
                    return self.mk(ExprKind::Cast(Box::new(value)), Type::Int, loc);
                }
                self.rvalue(value)
            }
            // Its value is the object itself, which is where it is computed with.
            Type::Wide(crate::types::WideKind::LongDouble) => Ok(e),
            // The value is typed as a double from here on so the expression still checks.
            Type::Wide(kind) => self.unsupported_value(
                Type::Double,
                format!(
                    "computing with values of type '{}' is not supported yet",
                    kind.name()
                ),
                loc,
            ),
            _ => {
                // A bit-field narrower than int promotes to int whatever its declared type.
                if let ExprKind::BitField { field, .. } = &e.kind {
                    // As GCC does it: whatever the declared type, a field whose values all fit.
                    let fits_int = !e.ty.is_int128()
                        && (field.width < 32 || (field.width == 32 && self.tcx.is_signed(&e.ty)));
                    if fits_int && e.ty != Type::Int {
                        return self.convert(e, &Type::Int, loc);
                    }
                }
                // `"ab"[1]` is a constant (GNU C accepts it in initializers).
                if let Some(value) = self.string_element(&e) {
                    return self.int_lit(value, e.ty.clone(), loc);
                }
                Ok(e)
            }
        }
    }

    /// The value of `"literal"[constant]`, for a literal of plain characters.
    fn string_element(&self, e: &Expr) -> Option<i64> {
        let ExprKind::Deref(address) = &e.kind else {
            return None;
        };
        let ExprKind::PtrAdd {
            ptr,
            index,
            scale: 1,
            sub: false,
        } = &address.kind
        else {
            return None;
        };
        let ExprKind::Decay(array) = &ptr.kind else {
            return None;
        };
        let ExprKind::StrLit(id) = array.kind else {
            return None;
        };
        if !matches!(e.ty, Type::Char) {
            return None;
        }
        let Ok(Const::Int(at)) = constexpr::eval(index, &self.tcx) else {
            return None;
        };
        let bytes = self.strings.get(id as usize)?;
        let byte = *bytes.get(usize::try_from(at).ok()?)?;
        Some(if self.tcx.target.char_is_signed() {
            i64::from(byte as i8)
        } else {
            i64::from(byte)
        })
    }

    fn scalar_rvalue(&self, e: Expr, what: &str) -> Res<Expr> {
        let e = self.rvalue(e)?;
        if e.ty.is_complex() {
            let loc = e.loc;
            return self.complex_truth(e, false, loc);
        }
        if e.ty.is_long_double() {
            // `x != 0`, which a NaN is.
            let loc = e.loc;
            let zero = self.long_double_lit(Extended::ZERO, loc)?;
            return self.long_double_compare(BinOp::Ne, e, zero, loc);
        }
        if !e.ty.is_scalar() {
            return err(
                e.loc,
                format!(
                    "{what} requires a scalar operand, got '{}'",
                    self.tcx.display(&e.ty)
                ),
            );
        }
        Ok(e)
    }

    /// Integer promotions (C11 6.3.1.1p2).
    pub(crate) fn promote(&self, e: Expr) -> Res<Expr> {
        if e.ty.is_integer() && e.ty.rank() < Type::Int.rank() {
            let loc = e.loc;
            return self.convert(e, &Type::Int, loc);
        }
        Ok(e)
    }

    /// Default argument promotions for variadic arguments.
    fn default_arg_promote(&self, e: Expr) -> Res<Expr> {
        if matches!(e.ty, Type::Float) {
            let loc = e.loc;
            return self.convert(e, &Type::Double, loc);
        }
        self.promote(e)
    }

    /// Converts scalar `e` to `to` without any legality checks. Constants are folded.
    pub(crate) fn convert(&self, e: Expr, to: &Type, loc: Loc) -> Res<Expr> {
        if e.ty == *to {
            return Ok(e);
        }
        // A 128-bit literal is its sign-extended 64-bit value; anything else stays a cast.
        let wide_mismatch = matches!(e.kind, ExprKind::IntLit(v) if v < 0)
            && ((to.is_int128() && !self.tcx.is_signed(&e.ty))
                || (matches!(e.ty, Type::UInt128) && !to.is_int128()));
        match (&e.kind, to) {
            _ if wide_mismatch => {}
            (ExprKind::IntLit(v), _) if to.is_integer() || to.is_ptr() => {
                // Narrow -> wide: the literal is already sign/zero extended per its own type.
                return self.int_lit(*v, to.clone(), loc);
            }
            (ExprKind::IntLit(v), Type::Float | Type::Double) if e.ty.is_integer() => {
                let as_float = if self.tcx.is_signed(&e.ty) {
                    *v as f64
                } else {
                    *v as u64 as f64
                };
                let rounded = if matches!(to, Type::Float) {
                    f64::from(as_float as f32)
                } else {
                    as_float
                };
                return self.float_lit(rounded, to.clone(), loc);
            }
            (ExprKind::IntLit(v), _) if to.is_long_double() && e.ty.is_integer() => {
                let value = if self.tcx.is_signed(&e.ty) {
                    Extended::from_i128(i128::from(*v))
                } else {
                    Extended::from_u128(u128::from(*v as u64))
                };
                return self.long_double_lit(value, loc);
            }
            (ExprKind::FloatLit(v), _) if to.is_long_double() => {
                return self.long_double_lit(Extended::from_f64(*v), loc);
            }
            (ExprKind::LongDoubleLit(v), Type::Float) => {
                return self.float_lit(f64::from(v.to_f32()), Type::Float, loc);
            }
            (ExprKind::LongDoubleLit(v), Type::Double) => {
                return self.float_lit(v.to_f64(), Type::Double, loc);
            }
            (ExprKind::LongDoubleLit(v), _) if to.is_integer() => {
                if let Some(folded) = constexpr::long_double_to_int(*v, to, &self.tcx) {
                    return self.int_lit(folded, to.clone(), loc);
                }
            }
            (ExprKind::FloatLit(v), Type::Float) => {
                return self.float_lit(f64::from(*v as f32), Type::Float, loc);
            }
            (ExprKind::FloatLit(v), Type::Double) => return self.float_lit(*v, Type::Double, loc),
            (ExprKind::FloatLit(v), _) if to.is_integer() => {
                if let Some(folded) = constexpr::float_to_int(*v, to, &self.tcx) {
                    return self.int_lit(folded, to.clone(), loc);
                }
            }
            _ => {}
        }
        self.mk(ExprKind::Cast(Box::new(e)), to.clone(), loc)
    }

    /// An explicit cast `(to)e`.
    /// A placeholder for a value that cannot be computed; an error only if it is reached
    /// by code generation or constant evaluation.
    pub(crate) fn unsupported_value(&self, ty: Type, message: String, loc: Loc) -> Res<Expr> {
        self.mk(ExprKind::Unsupported(Rc::from(message)), ty, loc)
    }

    pub(crate) fn cast(&self, e: Expr, to: &Type, loc: Loc) -> Res<Expr> {
        if to.is_void() {
            return self.mk(ExprKind::Cast(Box::new(e)), Type::Void, loc);
        }
        let e = self.rvalue(e)?;
        let to = to.unatomic();
        if let (Type::Wide(kind), false) = (to, to.is_long_double()) {
            return self.unsupported_value(
                to.clone(),
                format!("converting to '{}' is not supported yet", kind.name()),
                loc,
            );
        }
        if to.is_struct() && e.ty == *to {
            return Ok(e);
        }
        if to.is_vector() || e.ty.is_vector() {
            return self.vec_cast(e, to, loc);
        }
        if to.is_complex() {
            return self.to_complex(e, to, loc);
        }
        if e.ty.is_complex() {
            return self.from_complex(e, to, loc);
        }
        if !to.is_scalar() {
            return err(
                loc,
                format!("cannot cast to non-scalar type '{}'", self.tcx.display(to)),
            );
        }
        if !e.ty.is_scalar() {
            return err(
                loc,
                format!(
                    "cannot cast '{}' to '{}'",
                    self.tcx.display(&e.ty),
                    self.tcx.display(to)
                ),
            );
        }
        if (e.ty.is_real_floating() && to.is_ptr()) || (e.ty.is_ptr() && to.is_real_floating()) {
            return err(loc, "cannot cast between pointer and floating types");
        }
        self.convert(e, to, loc)
    }

    pub(crate) fn is_null_constant(&self, e: &Expr) -> bool {
        // `0`, or that cast to `void *` exactly (`(const void *)0` is not one).
        matches!(e.kind, ExprKind::IntLit(0))
            && (e.ty.is_integer() || matches!(e.ty.pointee(), Some(Type::Void)))
    }

    /// Conversion "as if by assignment" (C11 6.5.16.1): used for `=`, initializers,
    /// arguments and `return`.
    pub(crate) fn assign_convert(&self, e: Expr, to: &Type, loc: Loc, what: &str) -> Res<Expr> {
        let e = self.rvalue(e)?;
        let to = to.unatomic();
        if let (Type::Wide(kind), false) = (to, to.is_long_double()) {
            return self.unsupported_value(
                to.clone(),
                format!("converting to '{}' is not supported yet", kind.name()),
                loc,
            );
        }
        if to.is_vector() || e.ty.is_vector() {
            return self.vec_assign_convert(e, to, loc, what);
        }
        if to.is_complex() {
            return self.to_complex(e, to, loc);
        }
        if e.ty.is_complex() {
            return self.from_complex(e, to, loc);
        }
        let from = &e.ty;
        // A transparent union parameter takes any of its members' types.
        if let Type::Struct(id) = to {
            let def = self.tcx.struct_def(*id);
            if def.transparent && what == "passing an argument" && *from != *to {
                let member = def.members.iter().find(|m| {
                    let ty = m.ty.unatomic();
                    (ty.is_ptr() && (from.is_ptr() || self.is_null_constant(&e)))
                        || (ty.is_arith() && *ty == *from)
                });
                let Some(member) = member else {
                    return err(
                        loc,
                        format!(
                            "no member of transparent union '{}' takes a '{}'",
                            self.tcx.display(to),
                            self.tcx.display(from)
                        ),
                    );
                };
                let member_ty = member.ty.unatomic().clone();
                let value = self.convert(e, &member_ty, loc)?;
                return self.mk(ExprKind::TransparentUnion(Box::new(value)), to.clone(), loc);
            }
        }
        let ok = (to.is_arith() && from.is_arith())
            || (matches!(to, Type::Bool) && from.is_ptr())
            || (to.is_ptr() && (from.is_ptr() || self.is_null_constant(&e)))
            || (to.is_struct() && from == to);
        if !ok {
            return err(
                loc,
                format!(
                    "incompatible types when {what}: cannot convert '{}' to '{}'",
                    self.tcx.display(from),
                    self.tcx.display(to)
                ),
            );
        }
        if to.is_struct() {
            return Ok(e);
        }
        // `char *p = const_char_pointer;`: a constraint violation everyone only warns about.
        if let (Some(target), Some(source)) = (to.pointee(), from.pointee()) {
            let dropped = source
                .quals()
                .without(target.quals())
                .without(Quals::RESTRICT);
            if !dropped.is_empty() {
                let which = if dropped.has(Quals::CONST) {
                    "const"
                } else {
                    "volatile"
                };
                self.warnings.borrow_mut().push((
                    loc,
                    format!(
                        "{what} discards the '{which}' qualifier: '{}' to '{}'",
                        self.tcx.display(from),
                        self.tcx.display(to)
                    ),
                ));
            }
        }
        self.convert(e, to, loc)
    }

    /// The type an argument of type `ty` has after the default argument promotions.
    pub(crate) fn default_promoted_type(ty: &Type) -> Type {
        match ty {
            Type::Float => Type::Double,
            other => Self::promoted_type(other),
        }
    }

    fn promoted_type(ty: &Type) -> Type {
        if ty.is_integer() && ty.rank() < Type::Int.rank() {
            Type::Int
        } else {
            ty.clone()
        }
    }

    /// The common type of the usual arithmetic conversions (C11 6.3.1.8).
    fn arith_common_type(&self, a: &Type, b: &Type) -> Type {
        if a.is_long_double() || b.is_long_double() {
            return Type::Wide(crate::types::WideKind::LongDouble);
        }
        if matches!(a, Type::Double) || matches!(b, Type::Double) {
            return Type::Double;
        }
        if matches!(a, Type::Float) || matches!(b, Type::Float) {
            return Type::Float;
        }
        let pa = Self::promoted_type(a);
        let pb = Self::promoted_type(b);
        if pa == pb {
            return pa;
        }
        let (sa, sb) = (self.tcx.is_signed(&pa), self.tcx.is_signed(&pb));
        if sa == sb {
            return if pa.rank() >= pb.rank() { pa } else { pb };
        }
        let (signed, unsigned) = if sa { (pa, pb) } else { (pb, pa) };
        if unsigned.rank() >= signed.rank() {
            unsigned
        } else if self.tcx.size_of(&signed) > self.tcx.size_of(&unsigned) {
            signed
        } else {
            signed.to_unsigned()
        }
    }

    fn usual_arith(&self, a: Expr, b: Expr) -> Res<(Expr, Expr)> {
        let common = self.arith_common_type(&a.ty, &b.ty);
        let (la, lb) = (a.loc, b.loc);
        Ok((self.convert(a, &common, la)?, self.convert(b, &common, lb)?))
    }

    /// Folds an integer operation on two literals. (Floating operations are left for run time:
    /// what `0.0 / 0.0` is depends on the processor, and GCC does not fold it either.)
    fn fold(&self, e: Expr) -> Expr {
        let mut wide = e.ty.is_int128();
        e.for_each_child(|c| wide |= c.ty.is_int128());
        let foldable = !wide && e.ty.is_integer() && {
            let mut all_literals = true;
            e.for_each_child(|c| all_literals &= matches!(c.kind, ExprKind::IntLit(_)));
            all_literals
        };
        if !foldable {
            return e;
        }
        match constexpr::eval(&e, &self.tcx) {
            Ok(Const::Int(v)) => Expr {
                kind: ExprKind::IntLit(v),
                depth: 1,
                ..e
            },
            _ => e,
        }
    }

    fn pointee_size(&self, ptr_ty: &Type, loc: Loc) -> Res<u64> {
        match ptr_ty.pointee().map(Type::unqualified) {
            // GNU C: `void` and functions count as one byte.
            Some(Type::Void | Type::Func(_)) => Ok(1),
            Some(t) => match self.tcx.size_of(t) {
                Some(s) => Ok(s),
                None => err(
                    loc,
                    format!(
                        "arithmetic on a pointer to incomplete type '{}'",
                        self.tcx.display(t)
                    ),
                ),
            },
            None => err(loc, "pointer arithmetic on a non-pointer"),
        }
    }

    fn bad_operands(&self, op: &str, a: &Expr, b: &Expr, loc: Loc) -> Res<Expr> {
        err(
            loc,
            format!(
                "invalid operands to binary {op} ('{}' and '{}')",
                self.tcx.display(&a.ty),
                self.tcx.display(&b.ty)
            ),
        )
    }

    pub(crate) fn binary(&self, op: BinOp, a: Expr, b: Expr, loc: Loc) -> Res<Expr> {
        let a = self.rvalue(a)?;
        let b = self.rvalue(b)?;
        let spelling = match op {
            BinOp::Add => "+",
            BinOp::Sub => "-",
            BinOp::Mul => "*",
            BinOp::Div => "/",
            BinOp::Rem => "%",
            BinOp::And => "&",
            BinOp::Or => "|",
            BinOp::Xor => "^",
            BinOp::Shl => "<<",
            BinOp::Shr => ">>",
            BinOp::Eq => "==",
            BinOp::Ne => "!=",
            BinOp::Lt => "<",
            BinOp::Le => "<=",
            BinOp::Gt => ">",
            BinOp::Ge => ">=",
        };
        if a.ty.is_vector() || b.ty.is_vector() {
            return self.vec_binary(op, a, b, spelling, loc);
        }
        if a.ty.is_complex() || b.ty.is_complex() {
            return self.complex_binary(op, a, b, spelling, loc);
        }
        match op {
            BinOp::Add | BinOp::Sub if a.ty.is_ptr() && b.ty.is_integer() => {
                return self.ptr_add(a, b, op == BinOp::Sub, loc);
            }
            BinOp::Add if a.ty.is_integer() && b.ty.is_ptr() => {
                return self.ptr_add(b, a, false, loc);
            }
            BinOp::Sub if a.ty.is_ptr() && b.ty.is_ptr() => {
                let ty = self.ptrdiff_type();
                let (scale, divisor) = match self.pointee_scale(&a.ty, loc)? {
                    Scale::Const(0) => {
                        return err(loc, "subtraction of pointers to a zero-sized type");
                    }
                    Scale::Const(scale) => (scale, None),
                    Scale::Dynamic(size) => (1, Some(size)),
                };
                let bytes = self.mk(
                    ExprKind::PtrDiff {
                        a: Box::new(a),
                        b: Box::new(b),
                        scale,
                    },
                    ty.clone(),
                    loc,
                )?;
                return match divisor {
                    Some(size) => {
                        let size = self.convert(size, &ty, loc)?;
                        self.binary(BinOp::Div, bytes, size, loc)
                    }
                    None => Ok(bytes),
                };
            }
            BinOp::Add | BinOp::Sub | BinOp::Mul | BinOp::Div => {
                if !a.ty.is_arith() || !b.ty.is_arith() {
                    return self.bad_operands(spelling, &a, &b, loc);
                }
                let (a, b) = self.usual_arith(a, b)?;
                if op == BinOp::Add {
                    if let Some(rotated) = self.rotation(&a, &b, loc) {
                        return Ok(rotated);
                    }
                }
                let ty = a.ty.clone();
                Ok(self.fold(self.mk(ExprKind::Binary(op, Box::new(a), Box::new(b)), ty, loc)?))
            }
            BinOp::Rem | BinOp::And | BinOp::Or | BinOp::Xor => {
                if !a.ty.is_integer() || !b.ty.is_integer() {
                    return self.bad_operands(spelling, &a, &b, loc);
                }
                let (a, b) = self.usual_arith(a, b)?;
                if matches!(op, BinOp::Or | BinOp::Xor) {
                    if let Some(rotated) = self.rotation(&a, &b, loc) {
                        return Ok(rotated);
                    }
                }
                let ty = a.ty.clone();
                Ok(self.fold(self.mk(ExprKind::Binary(op, Box::new(a), Box::new(b)), ty, loc)?))
            }
            BinOp::Shl | BinOp::Shr => {
                if !a.ty.is_integer() || !b.ty.is_integer() {
                    return self.bad_operands(spelling, &a, &b, loc);
                }
                let a = self.promote(a)?;
                let bloc = b.loc;
                let b = self.convert(b, &Type::Int, bloc)?;
                let ty = a.ty.clone();
                Ok(self.fold(self.mk(ExprKind::Binary(op, Box::new(a), Box::new(b)), ty, loc)?))
            }
            BinOp::Eq | BinOp::Ne | BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge => {
                let (a, b) = if a.ty.is_arith() && b.ty.is_arith() {
                    self.usual_arith(a, b)?
                } else if a.ty.is_ptr() && b.ty.is_ptr() {
                    (a, b)
                } else if a.ty.is_ptr() && self.is_null_constant(&b) {
                    let ty = a.ty.clone();
                    let bloc = b.loc;
                    (a, self.convert(b, &ty, bloc)?)
                } else if b.ty.is_ptr() && self.is_null_constant(&a) {
                    let ty = b.ty.clone();
                    let aloc = a.loc;
                    (self.convert(a, &ty, aloc)?, b)
                } else {
                    return self.bad_operands(spelling, &a, &b, loc);
                };
                if a.ty.is_long_double() {
                    return self.long_double_compare(op, a, b, loc);
                }
                Ok(self.fold(self.mk(
                    ExprKind::Binary(op, Box::new(a), Box::new(b)),
                    Type::Int,
                    loc,
                )?))
            }
        }
    }

    fn ptr_add(&self, ptr: Expr, index: Expr, sub: bool, loc: Loc) -> Res<Expr> {
        let iloc = index.loc;
        let index = self.convert(index, &Type::LLong, iloc)?;
        let (scale, index) = match self.pointee_scale(&ptr.ty, loc)? {
            Scale::Const(scale) => (scale, index),
            Scale::Dynamic(size) => (1, self.binary(BinOp::Mul, index, size, loc)?),
        };
        let ty = ptr.ty.clone();
        self.mk(
            ExprKind::PtrAdd {
                ptr: Box::new(ptr),
                index: Box::new(index),
                scale,
                sub,
            },
            ty,
            loc,
        )
    }

    pub(crate) fn neg(&self, e: Expr, loc: Loc) -> Res<Expr> {
        let e = self.rvalue(e)?;
        if e.ty.is_vector() {
            return self.vec_neg(e, loc);
        }
        if e.ty.is_complex() {
            return self.complex_unary(e, false, loc);
        }
        if !e.ty.is_arith() {
            return err(
                loc,
                format!("invalid operand to unary - ('{}')", self.tcx.display(&e.ty)),
            );
        }
        let e = self.promote(e)?;
        let ty = e.ty.clone();
        Ok(self.fold(self.mk(ExprKind::Neg(Box::new(e)), ty, loc)?))
    }

    pub(crate) fn unary_plus(&self, e: Expr, loc: Loc) -> Res<Expr> {
        let e = self.rvalue(e)?;
        if e.ty.is_vector() || e.ty.is_complex() {
            return Ok(e);
        }
        if !e.ty.is_arith() {
            return err(
                loc,
                format!("invalid operand to unary + ('{}')", self.tcx.display(&e.ty)),
            );
        }
        self.promote(e)
    }

    pub(crate) fn bit_not(&self, e: Expr, loc: Loc) -> Res<Expr> {
        let e = self.rvalue(e)?;
        if e.ty.is_vector() {
            return self.vec_bit_not(e, loc);
        }
        if e.ty.is_complex() {
            return self.complex_unary(e, true, loc);
        }
        if !e.ty.is_integer() {
            return err(
                loc,
                format!("invalid operand to unary ~ ('{}')", self.tcx.display(&e.ty)),
            );
        }
        let e = self.promote(e)?;
        let ty = e.ty.clone();
        Ok(self.fold(self.mk(ExprKind::BitNot(Box::new(e)), ty, loc)?))
    }

    pub(crate) fn log_not(&self, e: Expr, loc: Loc) -> Res<Expr> {
        let e = self.rvalue(e)?;
        if e.ty.is_vector() {
            return self.vec_log_not(e, loc);
        }
        let e = self.scalar_rvalue(e, "'!'")?;
        Ok(self.fold(self.mk(ExprKind::LogNot(Box::new(e)), Type::Int, loc)?))
    }

    pub(crate) fn logical(&self, is_and: bool, a: Expr, b: Expr, loc: Loc) -> Res<Expr> {
        let what = if is_and { "'&&'" } else { "'||'" };
        let (a, b) = (self.rvalue(a)?, self.rvalue(b)?);
        if a.ty.is_vector() || b.ty.is_vector() {
            return self.vec_logical(is_and, a, b, loc);
        }
        let a = self.scalar_rvalue(a, what)?;
        let b = self.scalar_rvalue(b, what)?;
        let kind = if is_and {
            ExprKind::LogAnd(Box::new(a), Box::new(b))
        } else {
            ExprKind::LogOr(Box::new(a), Box::new(b))
        };
        self.mk(kind, Type::Int, loc)
    }

    /// A controlling expression of `if`/`while`/`for`/`?:`.
    pub(crate) fn condition(&self, e: Expr) -> Res<Expr> {
        self.scalar_rvalue(e, "a condition")
    }

    pub(crate) fn conditional(&self, c: Expr, a: Expr, b: Expr, loc: Loc) -> Res<Expr> {
        let typed = self.conditional_unfolded(c, a, b, loc)?;
        // With a constant condition only the chosen arm is kept, so the dead arms of
        // type-generic header macros never reach code generation.
        match typed.kind {
            ExprKind::Cond(c, a, b) => match c.kind {
                ExprKind::IntLit(v) if c.ty.is_integer() => Ok(if v != 0 { *a } else { *b }),
                _ => Ok(Expr {
                    kind: ExprKind::Cond(c, a, b),
                    ..typed
                }),
            },
            _ => Ok(typed),
        }
    }

    fn conditional_unfolded(&self, c: Expr, a: Expr, b: Expr, loc: Loc) -> Res<Expr> {
        let c = self.rvalue(c)?;
        let a = self.rvalue(a)?;
        let b = self.rvalue(b)?;
        if c.ty.is_vector() {
            return self.vec_select(c, a, b, loc);
        }
        let c = self.condition(c)?;
        let (a, b, ty) = if (a.ty.is_complex() || b.ty.is_complex())
            && (a.ty.is_arith() || a.ty.is_complex())
            && (b.ty.is_arith() || b.ty.is_complex())
        {
            // Both arms take the complex type `a + b` would have.
            let (aloc, bloc) = (a.loc, b.loc);
            let sum = self.complex_binary(BinOp::Add, a.clone(), b.clone(), "?:", loc)?;
            let ty = sum.ty;
            (
                self.to_complex(a, &ty, aloc)?,
                self.to_complex(b, &ty, bloc)?,
                ty,
            )
        } else if a.ty.is_vector() && b.ty.is_vector() {
            let b = self.vec_assign_convert(b, &a.ty, loc, "evaluating '?:'")?;
            let ty = a.ty.clone();
            (a, b, ty)
        } else if a.ty.is_arith() && b.ty.is_arith() {
            let (a, b) = self.usual_arith(a, b)?;
            let ty = a.ty.clone();
            (a, b, ty)
        } else if a.ty.is_void() || b.ty.is_void() {
            // Only one void arm is a GNU extension: the other one is evaluated for its
            // side effects.
            let (aloc, bloc) = (a.loc, b.loc);
            let a = if a.ty.is_void() {
                a
            } else {
                self.cast(a, &Type::Void, aloc)?
            };
            let b = if b.ty.is_void() {
                b
            } else {
                self.cast(b, &Type::Void, bloc)?
            };
            (a, b, Type::Void)
        } else if a.ty.is_struct() && a.ty == b.ty {
            let ty = a.ty.clone();
            (a, b, ty)
        } else if a.ty.is_ptr() && self.is_null_constant(&b) {
            let ty = a.ty.clone();
            let bloc = b.loc;
            let b = self.convert(b, &ty, bloc)?;
            (a, b, ty)
        } else if b.ty.is_ptr() && self.is_null_constant(&a) {
            let ty = b.ty.clone();
            let aloc = a.loc;
            let a = self.convert(a, &ty, aloc)?;
            (a, b, ty)
        } else if a.ty.is_ptr() && b.ty.is_integer() && !b.ty.is_pair() {
            // A constraint violation every compiler only warns about.
            let ty = a.ty.clone();
            let bloc = b.loc;
            let b = self.convert(b, &ty, bloc)?;
            (a, b, ty)
        } else if b.ty.is_ptr() && a.ty.is_integer() && !a.ty.is_pair() {
            let ty = b.ty.clone();
            let aloc = a.loc;
            let a = self.convert(a, &ty, aloc)?;
            (a, b, ty)
        } else if let (Some(x), Some(y)) = (a.ty.pointee(), b.ty.pointee()) {
            // The pointee has the qualifiers of both; `void` wins over an object type, and a
            // known array bound over an unknown one (C11 6.5.15p6).
            let quals = x.quals().with(y.quals());
            let (x, y) = (x.unqualified(), y.unqualified());
            let pointee = if x.is_void() || y.is_void() {
                Type::Void
            } else if matches!(x, Type::Array(_, None)) && Self::compatible(x, y) {
                y.clone()
            } else {
                x.clone()
            };
            let ty = pointee.qualified(quals).ptr_to();
            let (aloc, bloc) = (a.loc, b.loc);
            (self.convert(a, &ty, aloc)?, self.convert(b, &ty, bloc)?, ty)
        } else {
            return err(
                loc,
                format!(
                    "incompatible operand types in conditional expression ('{}' and '{}')",
                    self.tcx.display(&a.ty),
                    self.tcx.display(&b.ty)
                ),
            );
        };
        self.mk(
            ExprKind::Cond(Box::new(c), Box::new(a), Box::new(b)),
            ty,
            loc,
        )
    }

    pub(crate) fn comma(&self, a: Expr, b: Expr, loc: Loc) -> Res<Expr> {
        let b = self.rvalue(b)?;
        let ty = b.ty.clone();
        self.mk(ExprKind::Comma(Box::new(a), Box::new(b)), ty, loc)
    }

    fn check_modifiable(&self, e: &Expr, loc: Loc) -> Res<()> {
        if !e.is_lvalue() || matches!(e.kind, ExprKind::StrLit(_)) {
            return err(loc, "expression is not assignable");
        }
        if e.ty.is_array() {
            return err(loc, "array type is not assignable");
        }
        if e.ty.is_const() {
            return err(
                loc,
                format!(
                    "cannot assign to an lvalue of const-qualified type '{}'",
                    self.tcx.display(&e.ty)
                ),
            );
        }
        if !self.tcx.is_complete(&e.ty) {
            return err(
                loc,
                format!(
                    "incomplete type '{}' is not assignable",
                    self.tcx.display(&e.ty)
                ),
            );
        }
        Ok(())
    }

    pub(crate) fn assign(&self, lhs: Expr, rhs: Expr, loc: Loc) -> Res<Expr> {
        self.check_modifiable(&lhs, loc)?;
        if lhs.ty.is_atomic() {
            return self.atomic_assign(lhs, rhs, loc);
        }
        let rhs = self.assign_convert(rhs, &lhs.ty, loc, "assigning")?;
        let ty = lhs.ty.unatomic().clone();
        self.mk(ExprKind::Assign(Box::new(lhs), Box::new(rhs)), ty, loc)
    }

    pub(crate) fn compound_assign(&self, op: BinOp, lhs: Expr, rhs: Expr, loc: Loc) -> Res<Expr> {
        self.check_modifiable(&lhs, loc)?;
        if lhs.ty.is_atomic() {
            return self.atomic_compound_assign(op, lhs, rhs, loc);
        }
        let rhs = self.rvalue(rhs)?;
        let ty = lhs.ty.unatomic().clone();
        if ty.is_complex() || rhs.ty.is_complex() {
            return self.complex_compound_assign(op, lhs, rhs, loc);
        }
        if ty.is_vector() {
            // Type-check `lhs op rhs` on a stand-in for the old value to find the operand's form.
            let old = self.vec_zero(&ty, loc)?;
            let checked = self.vec_binary(op, old, rhs, "compound assignment", loc)?;
            let ExprKind::Binary(_, _, rhs) = checked.kind else {
                return err(loc, "internal error: vector compound assignment");
            };
            if op.is_compare() {
                return err(loc, "invalid compound assignment");
            }
            return self.mk(
                ExprKind::CompoundAssign {
                    lhs: Box::new(lhs),
                    rhs,
                    op: CompoundOp::Arith(op),
                    op_ty: ty.clone(),
                },
                ty,
                loc,
            );
        }
        if !ty.is_scalar() {
            return err(
                loc,
                format!(
                    "invalid operand to compound assignment ('{}')",
                    self.tcx.display(&ty)
                ),
            );
        }
        if ty.is_ptr() {
            if !matches!(op, BinOp::Add | BinOp::Sub) || !rhs.ty.is_integer() {
                return err(loc, "invalid operands to compound assignment on a pointer");
            }
            let rloc = rhs.loc;
            let rhs = self.convert(rhs, &Type::LLong, rloc)?;
            let (scale, rhs) = match self.pointee_scale(&ty, loc)? {
                Scale::Const(scale) => (scale, rhs),
                Scale::Dynamic(size) => (1, self.binary(BinOp::Mul, rhs, size, loc)?),
            };
            return self.mk(
                ExprKind::CompoundAssign {
                    lhs: Box::new(lhs),
                    rhs: Box::new(rhs),
                    op: CompoundOp::PtrAdd {
                        scale,
                        sub: op == BinOp::Sub,
                    },
                    op_ty: ty.clone(),
                },
                ty,
                loc,
            );
        }
        let int_only = matches!(
            op,
            BinOp::Rem | BinOp::And | BinOp::Or | BinOp::Xor | BinOp::Shl | BinOp::Shr
        );
        let operands_ok = if int_only {
            ty.is_integer() && rhs.ty.is_integer()
        } else {
            ty.is_arith() && rhs.ty.is_arith() && !op.is_compare()
        };
        if !operands_ok {
            return err(
                loc,
                format!(
                    "invalid operands to compound assignment ('{}' and '{}')",
                    self.tcx.display(&ty),
                    self.tcx.display(&rhs.ty)
                ),
            );
        }
        // The type the operation is carried out in, and the type its right operand has.
        let (op_ty, rhs_ty) = if matches!(op, BinOp::Shl | BinOp::Shr) {
            (Self::promoted_type(&ty), Type::Int)
        } else {
            let common = self.arith_common_type(&ty, &rhs.ty);
            (common.clone(), common)
        };
        let rloc = rhs.loc;
        let rhs = self.convert(rhs, &rhs_ty, rloc)?;
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

    pub(crate) fn inc_dec(&self, lhs: Expr, inc: bool, post: bool, loc: Loc) -> Res<Expr> {
        self.check_modifiable(&lhs, loc)?;
        if lhs.ty.is_atomic() {
            return self.atomic_inc_dec(lhs, inc, post, loc);
        }
        let ty = lhs.ty.unatomic().clone();
        let mut dynamic_scale = None;
        let scale = if ty.is_ptr() {
            match self.pointee_scale(&ty, loc)? {
                Scale::Const(scale) => scale,
                Scale::Dynamic(size) => {
                    dynamic_scale = Some(Box::new(size));
                    1
                }
            }
        } else if ty.is_arith() || ty.is_complex() {
            1
        } else {
            return err(
                loc,
                format!(
                    "cannot {} a value of type '{}'",
                    if inc { "increment" } else { "decrement" },
                    self.tcx.display(&ty)
                ),
            );
        };
        self.mk(
            ExprKind::IncDec {
                lhs: Box::new(lhs),
                inc,
                post,
                scale,
                dynamic_scale,
            },
            ty,
            loc,
        )
    }

    fn mark_addr_taken(&mut self, e: &Expr) {
        match &e.kind {
            ExprKind::Local(id) => {
                if let Some(local) = self
                    .func
                    .as_mut()
                    .and_then(|f| f.locals.get_mut(*id as usize))
                {
                    local.addr_taken = true;
                    local.addr_count = local.addr_count.saturating_add(1);
                }
            }
            ExprKind::Member(base, _)
            | ExprKind::BitField { base, .. }
            | ExprKind::ComplexPart(base, _)
            | ExprKind::VecElem(base, _) => self.mark_addr_taken(base),
            _ => {}
        }
    }

    pub(crate) fn addr_of(&mut self, e: Expr, loc: Loc) -> Res<Expr> {
        if e.ty.is_func() {
            return self.rvalue(e);
        }
        // `&*p` is just `p`.
        if let ExprKind::Deref(inner) = e.kind {
            return Ok(*inner);
        }
        if matches!(e.kind, ExprKind::BitField { .. }) {
            return err(loc, "cannot take the address of a bit-field");
        }
        if !e.is_lvalue() {
            return err(loc, "cannot take the address of an rvalue");
        }
        self.mark_addr_taken(&e);
        let ty = e.ty.clone().ptr_to();
        self.mk(ExprKind::AddrOf(Box::new(e)), ty, loc)
    }

    pub(crate) fn deref(&self, e: Expr, loc: Loc) -> Res<Expr> {
        let e = self.rvalue(e)?;
        let Some(pointee) = e.ty.pointee().cloned() else {
            return err(
                loc,
                format!(
                    "indirection requires a pointer operand ('{}' is invalid)",
                    self.tcx.display(&e.ty)
                ),
            );
        };
        // `*&x` is just `x`.
        if let ExprKind::AddrOf(inner) = e.kind {
            return Ok(*inner);
        }
        self.mk(ExprKind::Deref(Box::new(e)), pointee, loc)
    }

    pub(crate) fn index(&mut self, base: Expr, index: Expr, loc: Loc) -> Res<Expr> {
        let base = self.rvalue(base)?;
        let index = self.rvalue(index)?;
        if base.ty.is_vector() {
            return self.vec_index(base, index, loc);
        }
        if !((base.ty.is_ptr() && index.ty.is_integer())
            || (base.ty.is_integer() && index.ty.is_ptr()))
        {
            return err(
                loc,
                "subscripted value is not an array or pointer, or the index is not an integer",
            );
        }
        let sum = self.binary(BinOp::Add, base, index, loc)?;
        self.deref(sum, loc)
    }

    pub(crate) fn member(&self, base: Expr, name: &str, arrow: bool, loc: Loc) -> Res<Expr> {
        let base = if arrow {
            let base = self.rvalue(base)?;
            if !base.ty.pointee().is_some_and(|p| p.unatomic().is_struct()) {
                return err(
                    loc,
                    format!(
                        "member reference type '{}' is not a pointer to a struct or union",
                        self.tcx.display(&base.ty)
                    ),
                );
            }
            self.deref(base, loc)?
        } else {
            base
        };
        let Type::Struct(id) = base.ty.unatomic() else {
            return err(
                loc,
                format!(
                    "member reference base type '{}' is not a struct or union",
                    self.tcx.display(&base.ty)
                ),
            );
        };
        if !self.tcx.struct_def(*id).complete {
            return err(
                loc,
                format!(
                    "member access into incomplete type '{}'",
                    self.tcx.display(&base.ty)
                ),
            );
        }
        let base_quals = base.ty.quals().without(Quals::RESTRICT);
        let Some((ty, offset, bitfield)) = self.tcx.find_member(*id, name) else {
            return err(
                loc,
                format!(
                    "no member named '{name}' in '{}'",
                    self.tcx.display(&base.ty)
                ),
            );
        };
        // The members of a const or volatile struct are const or volatile.
        let ty = ty.qualified(base_quals);
        match bitfield {
            Some(field) => self.mk(
                ExprKind::BitField {
                    base: Box::new(base),
                    offset,
                    field,
                },
                ty,
                loc,
            ),
            None => self.mk(ExprKind::Member(Box::new(base), offset), ty, loc),
        }
    }

    pub(crate) fn call(&self, callee: Expr, args: Vec<Expr>, loc: Loc) -> Res<Expr> {
        let callee = self.rvalue(callee)?;
        let fty = match callee.ty.pointee() {
            Some(Type::Func(f)) => Rc::clone(f),
            _ => {
                return err(
                    loc,
                    format!(
                        "called object type '{}' is not a function or function pointer",
                        self.tcx.display(&callee.ty)
                    ),
                );
            }
        };
        if fty.ret.is_struct() && !self.tcx.is_complete(&fty.ret) {
            return err(loc, "calling a function that returns an incomplete type");
        }
        if let (Type::Wide(kind), false) = (&fty.ret, fty.ret.is_long_double()) {
            return self.unsupported_value(
                fty.ret.clone(),
                format!(
                    "calling a function that returns '{}' is not supported yet",
                    kind.name()
                ),
                loc,
            );
        }
        if fty.unprototyped {
            // No prototype: the arguments get the default promotions, and code generation
            // converts them to what the definition takes if it turns up in this unit.
            let mut promoted = Vec::with_capacity(args.len());
            for arg in args {
                let aloc = arg.loc;
                let arg = self.rvalue(arg)?;
                if arg.ty.is_struct() || arg.ty.is_complex() {
                    promoted.push(arg);
                } else if arg.ty.is_scalar() {
                    promoted.push(self.default_arg_promote(arg)?);
                } else {
                    return err(
                        aloc,
                        format!("cannot pass '{}' as an argument", self.tcx.display(&arg.ty)),
                    );
                }
            }
            let ret = fty.ret.clone();
            return self.mk(
                ExprKind::Call {
                    callee: Box::new(callee),
                    args: promoted,
                },
                ret,
                loc,
            );
        }
        if args.len() < fty.params.len() || (args.len() > fty.params.len() && !fty.variadic) {
            return err(
                loc,
                format!(
                    "wrong number of arguments: function takes {}{}, {} given",
                    if fty.variadic { "at least " } else { "" },
                    fty.params.len(),
                    args.len()
                ),
            );
        }
        let unchecked = match &callee.kind {
            ExprKind::Decay(f) | ExprKind::AddrOf(f) => match f.kind {
                ExprKind::Func(id) => self.old_style_functions.contains(&id),
                _ => false,
            },
            _ => false,
        };
        let mut converted = Vec::with_capacity(args.len());
        for (i, arg) in args.into_iter().enumerate() {
            let aloc = arg.loc;
            let arg = match fty.params.get(i) {
                // A pointer for an `int` parameter and the like: passed as it is.
                Some(param)
                    if unchecked
                        && param.is_scalar()
                        && (param.is_ptr() != arg.ty.is_ptr())
                        && (arg.ty.is_ptr() || arg.ty.is_array() || arg.ty.is_integer()) =>
                {
                    let arg = self.rvalue(arg)?;
                    self.cast(arg, param, aloc)?
                }
                Some(param) => self.assign_convert(arg, param, aloc, "passing an argument")?,
                None => {
                    let arg = self.rvalue(arg)?;
                    if arg.ty.is_struct() || arg.ty.is_complex() || self.tcx.is_half_vector(&arg.ty)
                    {
                        converted.push(arg);
                        continue;
                    }
                    if !arg.ty.is_scalar() {
                        return err(
                            aloc,
                            format!(
                                "cannot pass '{}' as a variadic argument",
                                self.tcx.display(&arg.ty)
                            ),
                        );
                    }
                    self.default_arg_promote(arg)?
                }
            };
            converted.push(arg);
        }
        let ret = fty.ret.clone();
        if let Some(op) = self.memory_builtin(&callee, &fty) {
            return self.mk(ExprKind::Intrinsic(op, converted), ret, loc);
        }
        self.mk(
            ExprKind::Call {
                callee: Box::new(callee),
                args: converted,
            },
            ret,
            loc,
        )
    }

    /// Whether `callee` is the C library's `memcpy`, `memmove` or `memset`, declared with
    /// its standard prototype and not defined in this unit.
    fn memory_builtin(&self, callee: &Expr, fty: &FuncType) -> Option<Intrinsic> {
        let (ExprKind::Decay(f) | ExprKind::AddrOf(f)) = &callee.kind else {
            return None;
        };
        let ExprKind::Func(id) = f.kind else {
            return None;
        };
        let function = self.funcs.get(id as usize)?;
        if function.body.is_some()
            || function.is_static
            || function
                .link_name
                .as_ref()
                .is_some_and(|l| *l != function.name)
        {
            return None;
        }
        let op = match &*function.name {
            "memcpy" | "memmove" => Intrinsic::MemCopy,
            "memset" => Intrinsic::MemSet,
            _ => return None,
        };
        let void_ptr = |ty: &Type| matches!(ty.pointee(), Some(p) if p.is_void());
        let [dst, second, size] = fty.params.as_slice() else {
            return None;
        };
        let second_ok = match op {
            Intrinsic::MemCopy => void_ptr(second),
            _ => *second == Type::Int,
        };
        let standard = !fty.variadic
            && !fty.unprototyped
            && void_ptr(&fty.ret)
            && void_ptr(dst)
            && second_ok
            && *size == self.size_type();
        standard.then_some(op)
    }

    /// An expression whose value nobody looks at: `e;`.
    pub(crate) fn expression_statement(&mut self, mut e: Expr) -> Expr {
        let is_copy = |e: &Expr| {
            matches!(
                e.kind,
                ExprKind::Intrinsic(Intrinsic::MemCopy | Intrinsic::MemSet, _)
            )
        };
        // `(void)memcpy(...)`.
        if matches!(&e.kind, ExprKind::Cast(inner) if e.ty.is_void() && is_copy(inner)) {
            if let ExprKind::Cast(inner) = e.kind {
                e = *inner;
            }
        }
        if !is_copy(&e) {
            return e;
        }
        e.ty = Type::Void;
        if let (ExprKind::Intrinsic(Intrinsic::MemCopy, args), Some(f)) = (&e.kind, &mut self.func)
        {
            if let [dst, src, n] = args.as_slice() {
                if let Ok(Const::Int(bytes)) = constexpr::eval(n, &self.tcx) {
                    for operand in [dst, src] {
                        if let Some(id) = punned_local(operand, bytes as u64, &f.locals, &self.tcx)
                        {
                            let local = &mut f.locals[id as usize];
                            local.punned_count = local.punned_count.saturating_add(1);
                        }
                    }
                }
            }
        }
        e
    }

    pub(crate) fn sizeof_type(&self, ty: &Type, loc: Loc) -> Res<Expr> {
        if self.tcx.is_variably_sized(ty) {
            return self.size_of_expr(ty, loc);
        }
        let size = match ty.unqualified() {
            Type::Void | Type::Func(_) => 1,
            _ => match self.tcx.size_of(ty) {
                Some(s) => s,
                None => {
                    return err(
                        loc,
                        format!(
                            "invalid application of 'sizeof' to incomplete type '{}'",
                            self.tcx.display(ty)
                        ),
                    );
                }
            },
        };
        self.int_lit(size as i64, self.size_type(), loc)
    }

    pub(crate) fn alignof_type(&self, ty: &Type, loc: Loc) -> Res<Expr> {
        let align = match ty.unqualified() {
            Type::Void | Type::Func(_) => 1,
            _ => match self.tcx.align_of(ty) {
                Some(a) => a,
                None => {
                    return err(
                        loc,
                        format!(
                            "invalid application of '_Alignof' to incomplete type '{}'",
                            self.tcx.display(ty)
                        ),
                    );
                }
            },
        };
        self.int_lit(align as i64, self.size_type(), loc)
    }

    /// `(type){ init }`. At block scope this is an unnamed local that is re-initialized on
    /// every evaluation; at file scope it is an unnamed static object.
    pub(crate) fn compound_literal(
        &mut self,
        ty: &Type,
        init: crate::init::Init,
        loc: Loc,
    ) -> Res<Expr> {
        if ty.is_func() || ty.is_void() {
            return err(loc, "invalid type for a compound literal");
        }
        let (ty, mut items) = self.elaborate_init(ty, init, loc)?;
        if self.flexible_end.get() > 0 {
            return err(
                loc,
                "a flexible array member cannot be initialized in a compound literal",
            );
        }
        // A vector literal is just its value.
        if ty.is_vector() && matches!(items.as_slice(), [InitItem::Scalar { offset: 0, .. }]) {
            if let Some(InitItem::Scalar { expr, .. }) = items.pop() {
                return Ok(expr);
            }
        }
        if self.func.is_none() {
            let (bytes, relocs) = self.static_init_data(&ty, &items, false, loc)?;
            self.globals.push(Global {
                name: Rc::from(format!(".compound_literal.{}", self.globals.len())),
                ty: ty.clone(),
                defined: true,
                init: bytes,
                relocs,
                has_initializer: true,
                align: None,
                link_name: None,
                is_static: true,
                thread_local: false,
                extra_size: 0,
                weak: false,
                linkonce: false,
            });
            let id = (self.globals.len() - 1) as GlobalId;
            return self.mk(ExprKind::Global(id), ty, loc);
        }
        let local = self.new_local(ty.clone());
        if let Some(var) = self
            .func
            .as_mut()
            .and_then(|f| f.locals.get_mut(local as usize))
        {
            var.addr_taken = true;
            var.addr_count = var.addr_count.saturating_add(1);
        }
        let whole_copy = matches!(items.as_slice(), [InitItem::Copy { offset: 0, .. }]);
        let zero_first = (ty.is_array() || ty.is_struct()) && !whole_copy;
        self.mk(
            ExprKind::CompoundLiteral {
                local,
                zero_first,
                items,
            },
            ty,
            loc,
        )
    }

    /// `a ?: b`: `a` is evaluated once, through an unnamed local.
    pub(crate) fn elvis(&mut self, a: Expr, b: Expr, loc: Loc) -> Res<Expr> {
        // A constant can be written twice: that keeps `x ?: y` a constant expression.
        if self.is_constant(&a) {
            let test = a.clone();
            return self.conditional(test, a, b, loc);
        }
        if self.func.is_none() {
            return err(
                loc,
                "'?:' with an omitted operand is only supported inside functions",
            );
        }
        let a = self.scalar_rvalue(a, "'?:'")?;
        let ty = a.ty.clone();
        let local = self.new_local(ty.clone());
        let store = {
            let target = self.mk(ExprKind::Local(local), ty.clone(), loc)?;
            self.mk(
                ExprKind::Assign(Box::new(target), Box::new(a)),
                ty.clone(),
                loc,
            )?
        };
        let test = self.mk(ExprKind::Local(local), ty.clone(), loc)?;
        let value = self.mk(ExprKind::Local(local), ty, loc)?;
        let chosen = self.conditional(test, value, b, loc)?;
        self.comma(store, chosen, loc)
    }

    /// `({ ... })`.
    pub(crate) fn statement_expr(&mut self, mut stmts: Vec<Stmt>, loc: Loc) -> Res<Expr> {
        // The last expression sits inside the scope of a variable length array or of a
        // variable with a cleanup: its value is taken there, before the scope is left.
        fn depth_of(stmts: &[Stmt]) -> usize {
            match stmts.last() {
                Some(Stmt::VlaScope { body, .. }) => 1 + depth_of(body),
                _ => 0,
            }
        }
        fn scope_at(stmts: &mut Vec<Stmt>, depth: usize) -> Option<&mut Vec<Stmt>> {
            if depth == 0 {
                return Some(stmts);
            }
            match stmts.last_mut() {
                Some(Stmt::VlaScope { body, .. }) => scope_at(body, depth - 1),
                _ => None,
            }
        }
        let depth = depth_of(&stmts);
        let last_value = match scope_at(&mut stmts, depth) {
            Some(body)
                if depth > 0 && matches!(body.last(), Some(Stmt::Expr(e)) if !e.ty.is_void()) =>
            {
                body.pop()
            }
            _ => None,
        };
        if let Some(Stmt::Expr(e)) = last_value {
            let value = self.rvalue(e)?;
            let ty = value.ty.clone();
            let temp = self.new_local(ty.clone());
            let target = self.mk(ExprKind::Local(temp), ty.clone(), loc)?;
            let store = self.assign(target, value, loc)?;
            if let Some(body) = scope_at(&mut stmts, depth) {
                body.push(Stmt::Expr(store));
            }
            let read = self.mk(ExprKind::Local(temp), ty, loc)?;
            stmts.push(Stmt::Expr(read));
        }
        // The value is that of the last statement if it is an expression, labelled or not.
        let mut labels = Vec::new();
        let mut last = stmts.pop();
        while let Some(Stmt::Label(label, inner)) = last {
            labels.push(label);
            last = Some(*inner);
        }
        let result = match last {
            Some(Stmt::Expr(e)) => Some(Box::new(self.rvalue(e)?)),
            Some(other) => {
                stmts.push(other);
                None
            }
            None => None,
        };
        if result.is_some() {
            for label in labels {
                stmts.push(Stmt::Label(label, Box::new(Stmt::Empty)));
            }
        } else if let Some(mut tail) = stmts.pop() {
            for label in labels.into_iter().rev() {
                tail = Stmt::Label(label, Box::new(tail));
            }
            stmts.push(tail);
        }
        let ty = result.as_ref().map_or(Type::Void, |r| r.ty.clone());
        let mut e = self.mk(ExprKind::StmtExpr { stmts, result }, ty, loc)?;
        e.has_control_flow = true;
        Ok(e)
    }

    /// A builtin that becomes an instruction sequence. `arg_ty` is the type the operand is
    /// converted to, `ty` the type of the result.
    pub(crate) fn intrinsic(
        &self,
        op: Intrinsic,
        arg: Option<(Expr, Type)>,
        ty: Type,
        loc: Loc,
    ) -> Res<Expr> {
        let args = match arg {
            Some((e, arg_ty)) => {
                vec![self.assign_convert(e, &arg_ty, loc, "passing an argument")?]
            }
            None => Vec::new(),
        };
        let mut e = self.mk(ExprKind::Intrinsic(op, args), ty, loc)?;
        if matches!(op, Intrinsic::Unreachable | Intrinsic::Trap) {
            e.has_control_flow = true;
        }
        Ok(e)
    }

    /// `alloca(size)` with the given alignment in bytes.
    pub(crate) fn alloca(&self, size: Expr, align: u64, loc: Loc) -> Res<Expr> {
        if self.func.is_none() {
            return err(loc, "alloca outside of a function");
        }
        let size = self.assign_convert(size, &self.size_type(), loc, "passing an argument")?;
        self.mk(
            ExprKind::Alloca(Box::new(size), align),
            Type::Void.ptr_to(),
            loc,
        )
    }

    /// Whether `name` called here means the stack allocation builtin: it does unless the
    /// program defines a function of that name.
    pub(crate) fn is_alloca_builtin(&self, name: &str) -> bool {
        // (`_alloca` is Microsoft's, an intrinsic of its compiler that <malloc.h> declares.)
        let microsoft = name == "_alloca" && self.tcx.target.os == crate::types::Os::Windows;
        if !microsoft
            && !matches!(
                name,
                "alloca" | "__builtin_alloca" | "__builtin_alloca_with_align"
            )
        {
            return false;
        }
        match self.lookup(name) {
            None => true,
            Some(Symbol::Func(id)) => self.funcs[*id as usize].body.is_none(),
            Some(_) => false,
        }
    }

    /// The type an expression of type `ty` has after lvalue conversion and decay.
    pub(crate) fn rvalue_type(&self, ty: &Type) -> Type {
        match ty {
            Type::Array(elem, _) | Type::Vla(elem, _) => Type::Ptr(Rc::clone(elem)),
            Type::Func(_) => ty.clone().ptr_to(),
            other => other.unatomic().clone(),
        }
    }

    /// Declares the C library function behind a `__builtin_` spelling, unless the program
    /// already declared it.
    pub(crate) fn declare_library_function(
        &mut self,
        name: &str,
        fty: Rc<FuncType>,
        loc: Loc,
    ) -> Res<FuncId> {
        if let Some(Symbol::Func(id)) = self.scopes[0].get(name) {
            return Ok(*id);
        }
        self.funcs.push(Function {
            name: Rc::from(name),
            ty: fty,
            is_static: false,
            external: true,
            linkonce: false,
            link_name: None,
            inlining: 0,
            constructor: None,
            destructor: None,
            weak: None,
            param_names: Vec::new(),
            body: None,
            first_use: None,
            loc,
        });
        let id = (self.funcs.len() - 1) as FuncId;
        self.scopes[0].insert(Rc::from(name), Symbol::Func(id));
        Ok(id)
    }

    pub(crate) fn function_ref(&mut self, id: FuncId, loc: Loc) -> Res<Expr> {
        let f = &mut self.funcs[id as usize];
        f.first_use.get_or_insert(loc);
        let ty = Type::Func(Rc::clone(&f.ty));
        self.mk(ExprKind::Func(id), ty, loc)
    }

    /// Size of the target's va_list object.
    pub(crate) fn va_list_size(&self) -> u64 {
        match self.lookup("__builtin_va_list") {
            Some(Symbol::Typedef(ty)) => self.tcx.size_of(ty).unwrap_or(8),
            _ => 8,
        }
    }

    /// The address of the va_list object an expression of type `va_list` designates. Where
    /// va_list is an array type the expression has already decayed when it is a parameter.
    fn va_list_address(&mut self, ap: Expr, loc: Loc) -> Res<Expr> {
        let Some(Symbol::Typedef(va_list)) = self.lookup("__builtin_va_list").cloned() else {
            return err(loc, "internal error: va_list is not declared");
        };
        let matches_object = ap.ty == va_list;
        let matches_decayed = match (&va_list, &ap.ty) {
            (Type::Array(elem, _), Type::Ptr(pointee)) => elem == pointee,
            _ => false,
        };
        if !matches_object && !matches_decayed {
            return err(
                loc,
                format!("expected a va_list, got '{}'", self.tcx.display(&ap.ty)),
            );
        }
        if va_list.is_array() {
            return self.rvalue(ap);
        }
        self.addr_of(ap, loc)
    }

    pub(crate) fn va_start(&mut self, ap: Expr, loc: Loc) -> Res<Expr> {
        if !self.func.as_ref().is_some_and(|f| f.variadic) {
            return err(
                loc,
                "va_start used in a function that does not take variable arguments",
            );
        }
        let address = self.va_list_address(ap, loc)?;
        self.mk(ExprKind::VaStart(Box::new(address)), Type::Void, loc)
    }

    pub(crate) fn va_arg(&mut self, ap: Expr, ty: Type, loc: Loc) -> Res<Expr> {
        let address = self.va_list_address(ap, loc)?;
        if let (Type::Wide(kind), false) = (&ty, ty.is_long_double()) {
            return self.unsupported_value(
                ty.clone(),
                format!("va_arg of type '{}' is not supported yet", kind.name()),
                loc,
            );
        }
        if ty.is_struct() && !self.tcx.is_complete(&ty) {
            return err(loc, "va_arg of an incomplete type");
        }
        if !ty.is_scalar() && !ty.is_struct() && !ty.is_complex() && !self.tcx.is_half_vector(&ty) {
            return err(
                loc,
                format!("invalid type '{}' for va_arg", self.tcx.display(&ty)),
            );
        }
        let mut e = self.mk(ExprKind::VaArg(Box::new(address)), ty, loc)?;
        e.has_control_flow = true;
        Ok(e)
    }

    pub(crate) fn va_copy(&mut self, dst: Expr, src: Expr, loc: Loc) -> Res<Expr> {
        let dst = self.va_list_address(dst, loc)?;
        let src = self.va_list_address(src, loc)?;
        self.mk(
            ExprKind::VaCopy(Box::new(dst), Box::new(src)),
            Type::Void,
            loc,
        )
    }

    /// `va_end(ap)`: checks the operand and does nothing.
    pub(crate) fn va_end(&mut self, ap: Expr, loc: Loc) -> Res<Expr> {
        let address = self.va_list_address(ap, loc)?;
        self.mk(ExprKind::Cast(Box::new(address)), Type::Void, loc)
    }

    /// Whether `e` folds to a constant (`__builtin_constant_p`).
    pub(crate) fn is_constant(&self, e: &Expr) -> bool {
        constexpr::eval(e, &self.tcx).is_ok()
    }

    /// Evaluates an integer constant expression (array sizes, case labels, enum values).
    pub(crate) fn const_int(&self, e: &Expr) -> Res<i64> {
        if !e.ty.is_integer() {
            return err(e.loc, "expression is not an integer constant expression");
        }
        match constexpr::eval(e, &self.tcx)? {
            Const::Int(v) => Ok(v),
            _ => err(e.loc, "expression is not an integer constant expression"),
        }
    }

    /// Converts the operand of `return`.
    pub(crate) fn return_value(&self, e: Expr, loc: Loc) -> Res<Expr> {
        let ret = match &self.func {
            Some(f) => f.ret.clone(),
            None => return err(loc, "return outside of a function"),
        };
        if ret.is_void() {
            return err(loc, "void function should not return a value");
        }
        self.assign_convert(e, &ret, loc, "returning")
    }
}

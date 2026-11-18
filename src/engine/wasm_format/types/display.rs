//! The names of types, in error messages and for debugging.

use core::fmt::{self, Debug, Display, Formatter};

use bun_engine_asm::Size;

use super::defined::{FuncType, Types};
use super::value::{
    AbstractHeapType, FieldType, HeapType, RefType, StorageType, TypeKind, ValKind, ValType,
};

fn heap_name(ty: AbstractHeapType) -> &'static str {
    match ty {
        AbstractHeapType::Func => "func",
        AbstractHeapType::NoFunc => "nofunc",
        AbstractHeapType::Extern => "extern",
        AbstractHeapType::NoExtern => "noextern",
        AbstractHeapType::Exn => "exnref",
        AbstractHeapType::NoExn => "noexnref",
        AbstractHeapType::Any => "any",
        AbstractHeapType::Eq => "eq",
        AbstractHeapType::I31 => "i31",
        AbstractHeapType::Struct => "struct",
        AbstractHeapType::Array => "array",
        AbstractHeapType::None => "none",
    }
}

fn shorthand_name(ty: AbstractHeapType) -> &'static str {
    match ty {
        AbstractHeapType::Func => "Funcref",
        AbstractHeapType::NoFunc => "Nofuncref",
        AbstractHeapType::Extern => "Externref",
        AbstractHeapType::NoExtern => "Noexternref",
        AbstractHeapType::Exn => "Exnref",
        AbstractHeapType::NoExn => "Noexnref",
        AbstractHeapType::Any => "Anyref",
        AbstractHeapType::Eq => "Eqref",
        AbstractHeapType::I31 => "I31ref",
        AbstractHeapType::Struct => "Structref",
        AbstractHeapType::Array => "Arrayref",
        AbstractHeapType::None => "Noneref",
    }
}

/// `I32`, `RefNull`
pub(crate) fn kind_name(ty: ValType) -> &'static str {
    match ty.kind() {
        _ if ty == ValType::UNKNOWN => "Unknown",
        ValKind::I32 => "I32",
        ValKind::I64 => "I64",
        ValKind::F32 => "F32",
        ValKind::F64 => "F64",
        ValKind::V128 => "V128",
        ValKind::Ref if ty.is_defaultable() => "RefNull",
        ValKind::Ref => "Ref",
    }
}

/// `I8`, `I32`, `RefNull`
pub(crate) fn storage_name(ty: StorageType) -> &'static str {
    match ty.packed_size() {
        Some(Size::S8) => "I8",
        Some(_) => "I16",
        None => kind_name(ty.unpacked()),
    }
}

fn comma_separated<T>(
    f: &mut Formatter<'_>,
    items: impl IntoIterator<Item = T>,
    write: impl Fn(&mut Formatter<'_>, T) -> fmt::Result,
) -> fmt::Result {
    for (i, item) in items.into_iter().enumerate() {
        if i > 0 {
            f.write_str(", ")?;
        }
        write(f, item)?;
    }
    Ok(())
}

/// `I32`, `(ref null func)`, `(ref <struct:3>)`
impl Display for ValType {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        let Some(reference) = self.as_ref() else {
            return f.write_str(kind_name(*self));
        };
        let null = if reference.is_nullable() { "null " } else { "" };
        let heap_type = reference.heap_type();
        let name = heap_name(heap_type.abstract_type());
        match heap_type.index() {
            Some(index) => write!(f, "(ref {null}<{name}:{index}>)"),
            None if heap_type == HeapType::UNKNOWN => write!(f, "(ref {null}unknown)"),
            None => write!(f, "(ref {null}{name})"),
        }
    }
}

impl Display for RefType {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        Display::fmt(&self.value_type(), f)
    }
}

/// `(I32, Ref) -> [I64]`
impl Display for FuncType<'_> {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        let kind = |f: &mut Formatter<'_>, ty: &ValType| f.write_str(kind_name(*ty));
        f.write_str("(")?;
        comma_separated(f, self.params, kind)?;
        f.write_str(") -> [")?;
        comma_separated(f, self.results, kind)?;
        f.write_str("]")
    }
}

/// `I32`, `Funcref`, or the definition of the type that is referred to.
pub(crate) struct Expanded<'a>(pub(crate) &'a Types, pub(crate) ValType);

impl Display for Expanded<'_> {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        let Self(types, ty) = *self;
        let Some(reference) = ty.as_ref() else {
            return f.write_str(kind_name(ty));
        };
        let Some(index) = reference.heap_type().index() else {
            return f.write_str(shorthand_name(reference.heap_type().abstract_type()));
        };
        let field = |f: &mut Formatter<'_>, field: FieldType| {
            let mutability = if field.mutable {
                "mutable"
            } else {
                "immutable"
            };
            write!(f, "{mutability} {}", storage_name(field.storage))
        };
        if types.kind(index) == TypeKind::Func {
            return Display::fmt(&types.func_type(index), f);
        }
        f.write_str("(")?;
        if types.kind(index) == TypeKind::Array {
            field(f, types.array_type(index).element)?;
        } else {
            let fields = types.struct_type(index).fields;
            comma_separated(f, fields.iter().map(|field| field.ty), field)?;
        }
        f.write_str(")")
    }
}

impl Debug for ValType {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        Display::fmt(self, f)
    }
}

impl Debug for RefType {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        Display::fmt(self, f)
    }
}

impl Debug for HeapType {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        let name = heap_name(self.abstract_type());
        match self.index() {
            Some(index) => write!(f, "<{name}:{index}>"),
            None => f.write_str(name),
        }
    }
}

impl Debug for StorageType {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        match self.packed_size() {
            Some(_) => f.write_str(storage_name(*self)),
            None => Display::fmt(&self.unpacked(), f),
        }
    }
}

//! All that a stub has to know of a type.

use bun_engine_wasm_compiler::cast::ObjectCheck;
use bun_engine_wasm_format::{AbstractHeapType, HeapType, TypeIndex, TypeKind, ValKind, ValType};
use bun_engine_wasm_runtime::Module;

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub(super) enum Kind {
    I32,
    I64,
    F32,
    F64,
    Reference { is_nullable: bool, to: Referent },
}

/// `header` is the offset in the instance of that for objects of the type.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub(super) enum Referent {
    Extern,
    Any,
    Eq,
    I31,
    Func,
    OfFinalType {
        header: i32,
    },
    /// With the offset of the entry in the `ObjectType`.
    OfOpenType {
        header: i32,
        entry: i32,
    },
    /// It takes a call to find out.
    Other,
}

impl Referent {
    fn of(module: &Module, ty: HeapType) -> Referent {
        let (types, header) = (module.types(), |ty| module.layout().object_header(ty));
        let Some(index) = ty.index() else {
            return match ty.abstract_type() {
                AbstractHeapType::Extern => Referent::Extern,
                AbstractHeapType::Any => Referent::Any,
                AbstractHeapType::Eq => Referent::Eq,
                AbstractHeapType::I31 => Referent::I31,
                AbstractHeapType::Func => Referent::Func,
                _ => Referent::Other,
            };
        };
        if types.kind(index) == TypeKind::Func {
            return Referent::Other;
        }
        match ObjectCheck::new(types, index) {
            ObjectCheck::Is { expected } => Referent::OfFinalType {
                header: header(expected),
            },
            ObjectCheck::EntryIs { offset, expected } => Referent::OfOpenType {
                header: header(expected),
                entry: offset,
            },
            ObjectCheck::Rtt(_) | ObjectCheck::KindIs(_) => Referent::Other,
        }
    }
}

impl Kind {
    /// Scripts have values for it.
    fn of(module: &Module, ty: ValType) -> Kind {
        match (ty.as_ref(), ty.kind()) {
            (Some(reference), _) => Kind::Reference {
                is_nullable: reference.is_nullable(),
                to: Referent::of(module, reference.heap_type()),
            },
            (None, ValKind::I32) => Kind::I32,
            (None, ValKind::I64) => Kind::I64,
            (None, ValKind::F32) => Kind::F32,
            (None, _) => Kind::F64,
        }
    }

    const UNCHECKED: Kind = Kind::Reference {
        is_nullable: true,
        to: Referent::Extern,
    };

    /// For a value that leaves WebAssembly.
    fn without_check(self) -> Kind {
        match self {
            Kind::Reference { .. } => Kind::UNCHECKED,
            number => number,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum Direction {
    FromScript,
    ToScript,
}

/// Functions that are alike in this share a stub.
#[derive(Clone, PartialEq, Eq, Hash)]
pub(super) struct Key {
    direction: Direction,
    pub(super) params: Box<[Kind]>,
    pub(super) results: Box<[Kind]>,
}

impl Key {
    pub(super) fn new(direction: Direction, module: &Module, ty: TypeIndex) -> Key {
        let ty = module.types().func_type(ty);
        let kinds = |types: &[ValType], leave_when| {
            let kinds = types.iter().map(|&ty| Kind::of(module, ty));
            match direction == leave_when {
                true => kinds.map(Kind::without_check).collect(),
                false => kinds.collect(),
            }
        };
        Key {
            direction,
            params: kinds(ty.params, Direction::ToScript),
            results: kinds(ty.results, Direction::FromScript),
        }
    }
}

use crate::ir::{FunctionKey, LayoutKey, VariableKey};
use bun_sema::bind::SymbolId;
use bun_sema::check::aot::{ClassRef, FunctionRef};
use bun_sema::hir::{ClassId, FnId};
use bun_sema::program::{FileId, Sym};

pub(crate) fn test_function_key(file: u32, function: u32) -> FunctionKey {
    FunctionKey::Source(FunctionRef {
        file: FileId(file),
        function: FnId(function),
    })
}

pub(crate) fn test_class_key(file: u32, class: u32) -> LayoutKey {
    LayoutKey::Class(ClassRef {
        file: FileId(file),
        class: ClassId(class),
    })
}

pub(crate) fn test_variable_key(file: u32, symbol: u32) -> VariableKey {
    VariableKey::Symbol(Sym {
        file: FileId(file),
        id: SymbolId(symbol),
    })
}

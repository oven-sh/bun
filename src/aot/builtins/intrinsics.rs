use super::names::BuiltinNames;
use super::table::{self, Intrinsic, IntrinsicPosition, NativeCallKind};
use crate::ir::WellKnownSymbol;
use bun_sema::atom::Atom;

#[cfg(test)]
mod tests;

pub fn find_intrinsic(
    names: &BuiltinNames,
    spelling: Atom,
    position: IntrinsicPosition,
) -> Option<Intrinsic> {
    let found = table::intrinsic_of(names.get_private(spelling)?, position)?;
    let has_own_lookup = matches!(found, Intrinsic::NativeCall(_) | Intrinsic::SymbolKey(_));
    (!has_own_lookup).then_some(found)
}

pub fn find_symbol_key(names: &BuiltinNames, spelling: Atom) -> Option<WellKnownSymbol> {
    let name = names.get_symbol_key(spelling)?;
    match table::intrinsic_of(name, IntrinsicPosition::Member) {
        Some(Intrinsic::SymbolKey(symbol)) => Some(symbol),
        Some(_) | None => None,
    }
}

pub fn find_native_call_kind(names: &BuiltinNames, callee: Atom) -> Option<NativeCallKind> {
    let name = names.get_private(callee)?;
    match table::intrinsic_of(name, IntrinsicPosition::Call) {
        Some(Intrinsic::NativeCall(kind)) => Some(kind),
        Some(_) | None => None,
    }
}

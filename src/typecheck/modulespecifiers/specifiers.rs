// modulespecifiers/specifiers.go: the specifiers that name a module from a file. The generation itself is not ported yet: the entry records a stand-in and gives no specifier, which the node builder prints as an empty module name.
use crate::ast::{NodeId, SymbolId};
use crate::checker::Checker;
use crate::modulespecifiers::types::{ModuleSpecifierOptions, UserPreferences};

pub fn get_module_specifiers(
    c: &mut Checker<'_>,
    _module_symbol: SymbolId,
    _importing_source_file: NodeId,
    _user_preferences: UserPreferences,
    _options: ModuleSpecifierOptions,
    _for_auto_imports: bool,
) -> Vec<Vec<u8>> {
    let _: () = c.stand_in("modulespecifiers.GetModuleSpecifiers");
    Vec::new()
}

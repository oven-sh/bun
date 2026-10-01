// checker.go 16405-16433 (c27_resolve_alias, layer A-ALIAS): resolveAliasWithDeprecationCheck.
use crate::ast::flags_generated::SymbolFlags;
use crate::checker::checker::Checker;
use crate::tscore::ids::{NodeId, SymbolId};
use crate::tscore::internal::LoopGuard;

impl<'a> Checker<'a> {
    pub fn resolve_alias_with_deprecation_check(
        &mut self,
        mut symbol: SymbolId,
        location: NodeId,
    ) -> SymbolId {
        if !self.ast.sym(symbol).flags.intersects(SymbolFlags::ALIAS)
            || self.is_deprecated_symbol(symbol)
            || self.get_declaration_of_alias_symbol(symbol).is_nil()
        {
            return symbol;
        }
        let target_symbol = self.resolve_alias(symbol);
        if target_symbol == self.unknown_symbol {
            return target_symbol;
        }
        // Upstream's loop does not end when a target has no declarations and is not the resolved target: the guard cuts it.
        let mut guard = LoopGuard::new();
        while self.ast.sym(symbol).flags.intersects(SymbolFlags::ALIAS) {
            if !guard.turn() {
                self.loop_limit("resolveAliasWithDeprecationCheck");
                break;
            }
            let target = self.get_immediate_aliased_symbol(symbol);
            if !target.is_nil() {
                if target == target_symbol {
                    break;
                }
                let declarations = self.ast.sym(target).declarations;
                if declarations.len() != 0 {
                    if self.is_deprecated_symbol(target) {
                        let name = self.ast.sym(target).name;
                        self.add_deprecated_suggestion(location, declarations, name);
                        break;
                    } else {
                        if symbol == target_symbol {
                            break;
                        }
                        symbol = target;
                    }
                }
            } else {
                break;
            }
        }
        target_symbol
    }
}

// checker.go 16405-16435 (c27_resolve_alias): resolveAliasWithDeprecationCheck, a loop that upstream leaves only when its data allows it.
use crate::ast::flags_generated::SymbolFlags;
use crate::checker::checker::Checker;
use crate::tscore::golang::{List, Text};
use crate::tscore::ids::{NodeId, SymbolId};

// More turns than an alias chain can have links: every turn that does not leave the loop moves to another symbol.
const ALIAS_CHAIN_LIMIT: u32 = 1 << 20;

impl<'a> Checker<'a> {
    pub fn resolve_alias_with_deprecation_check(
        &mut self,
        symbol: SymbolId,
        location: NodeId,
    ) -> SymbolId {
        let a = self.ast;
        let mut symbol = symbol;
        if !a.sym(symbol).flags.intersects(SymbolFlags::ALIAS)
            || self.is_deprecated_symbol(symbol)
            || self.get_declaration_of_alias_symbol(symbol).is_nil()
        {
            return symbol;
        }
        let target_symbol = self.resolve_alias(symbol);
        if target_symbol == self.unknown_symbol {
            return target_symbol;
        }
        let mut turns = 0;
        while a.sym(symbol).flags.intersects(SymbolFlags::ALIAS) {
            turns += 1;
            if turns > ALIAS_CHAIN_LIMIT {
                self.loop_limit("resolveAliasWithDeprecationCheck");
                break;
            }
            let target = self.get_immediate_aliased_symbol(symbol);
            if !target.is_nil() {
                if target == target_symbol {
                    break;
                }
                if a.sym(target).declarations.len() != 0 {
                    if self.is_deprecated_symbol(target) {
                        let target_data = a.sym(target);
                        self.add_deprecated_suggestion(
                            location,
                            target_data.declarations,
                            target_data.name,
                        );
                        break;
                    } else {
                        if symbol == target_symbol {
                            break;
                        }
                        symbol = target;
                    }
                } else {
                    // Upstream spins here: the symbol stays the same and nothing else can change.
                    self.loop_limit("resolveAliasWithDeprecationCheck");
                    break;
                }
            } else {
                break;
            }
        }
        target_symbol
    }

    pub fn is_deprecated_symbol(&mut self, symbol: SymbolId) -> bool {
        let _ = symbol;
        self.stand_in("isDeprecatedSymbol")
    }
    pub fn get_declaration_of_alias_symbol(&mut self, symbol: SymbolId) -> NodeId {
        self.stand_ins.record("getDeclarationOfAliasSymbol");
        self.ast.sym(symbol).declarations.at(0usize)
    }
    // The scripted links are a hook of this scratch: aliasTarget stands for the resolved target, immediateTarget for the next link.
    pub fn resolve_alias(&mut self, symbol: SymbolId) -> SymbolId {
        self.stand_ins.record("resolveAlias");
        let links = self.alias_symbol_links.get(symbol);
        self.alias_symbol_links[links].alias_target
    }
    pub fn get_immediate_aliased_symbol(&mut self, symbol: SymbolId) -> SymbolId {
        self.stand_ins.record("getImmediateAliasedSymbol");
        let links = self.alias_symbol_links.get(symbol);
        self.alias_symbol_links[links].immediate_target
    }
    pub fn add_deprecated_suggestion(
        &mut self,
        location: NodeId,
        declarations: List<'a, NodeId>,
        deprecated_entity: Text<'a>,
    ) {
        let _ = (location, declarations, deprecated_entity);
        self.stand_in("addDeprecatedSuggestion")
    }
}

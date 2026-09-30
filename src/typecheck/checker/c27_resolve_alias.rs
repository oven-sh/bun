// checker.go:16349-16493 (layer A-ALIAS): the resolution of an alias symbol with its circularity check, the walk along an alias chain for deprecated targets, the combined flags of an alias and its targets, and the declaration of an alias.
use crate::ast::{
    Arg, NodeId, SymbolFlags, SymbolId, is_alias_symbol_declaration, is_non_local_alias,
};
use crate::checker::{Checker, TypeSystemEntity, TypeSystemPropertyName};
use crate::collections::Set;
use crate::core::{find_last, or_else};
use crate::diagnostics;
use crate::internal::LoopGuard;

impl<'a> Checker<'a> {
    pub fn resolve_alias_exported(&mut self, symbol: SymbolId) -> (SymbolId, bool) {
        if symbol.is_nil() {
            return (SymbolId::NIL, false);
        }
        let resolved = self.resolve_alias(symbol);
        (resolved, resolved != self.unknown_symbol)
    }

    // Resolve an alias symbol to the first target symbol in the resolution chain that includes some other meaning. Pure aliases are eagerly resolved and any type-only markers are back-propagated to the original symbol. The function panics if the argument is not a symbol with an alias meaning: here that is an internal diagnostic and the unknown symbol.
    pub fn resolve_alias(&mut self, symbol: SymbolId) -> SymbolId {
        if !self.stack_check.is_safe_to_recurse() {
            let _: () = self.stack_limit();
            return self.unknown_symbol;
        }
        let a = self.ast;
        if !a.sym(symbol).flags.intersects(SymbolFlags::ALIAS) {
            let _: () = self.fail("Should only get alias here");
            return self.unknown_symbol;
        }
        let links = self.alias_symbol_links.get(symbol);
        if self.alias_symbol_links[links].alias_target.is_nil() {
            if !self.push_type_resolution(
                TypeSystemEntity::Symbol(symbol),
                TypeSystemPropertyName::AliasTarget,
            ) {
                return self.unknown_symbol;
            }
            let node = self.get_declaration_of_alias_symbol(symbol);
            if node.is_nil() {
                // Upstream panics here: the nil declaration has no target, so the alias resolves to the unknown symbol below and the resolution stack stays balanced.
                let _: () = self.fail("Unexpected nil in resolveAlias for symbol");
            }
            let mut target = self.get_target_of_alias_declaration(node);
            if is_non_local_alias(
                a,
                target,
                SymbolFlags::VALUE | SymbolFlags::TYPE | SymbolFlags::NAMESPACE,
            ) {
                // When the target is a pure alias, we transitively resolve and propagate any typeOnlyDeclaration
                target = self.resolve_indirection_alias(symbol, target);
            }
            self.alias_symbol_links[links].alias_target = or_else(target, self.unknown_symbol);
            if !self.pop_type_resolution() {
                let symbol_name = self.symbol_to_string(symbol);
                self.error(
                    node,
                    diagnostics::CIRCULAR_DEFINITION_OF_IMPORT_ALIAS_0,
                    &[Arg::Str(&symbol_name)],
                );
                self.alias_symbol_links[links].alias_target = self.unknown_symbol;
            }
        }
        self.alias_symbol_links[links].alias_target
    }

    pub fn resolve_indirection_alias(&mut self, source: SymbolId, target: SymbolId) -> SymbolId {
        let resolved = self.resolve_alias(target);
        let result = self.get_merged_symbol(resolved);
        let target_links = self.alias_symbol_links.get(target);
        let type_only_declaration = self.alias_symbol_links[target_links].type_only_declaration;
        if !type_only_declaration.is_nil() {
            let source_links = self.alias_symbol_links.get(source);
            if self.alias_symbol_links[source_links]
                .type_only_declaration
                .is_nil()
            {
                self.alias_symbol_links[source_links].type_only_declaration = type_only_declaration;
            }
        }
        result
    }

    pub fn try_resolve_alias(&mut self, symbol: SymbolId) -> SymbolId {
        let links = self.alias_symbol_links.get(symbol);
        if !self.alias_symbol_links[links].alias_target.is_nil()
            || self.find_resolution_cycle_start_index(
                TypeSystemEntity::Symbol(symbol),
                TypeSystemPropertyName::AliasTarget,
            ) < 0
        {
            return self.resolve_alias(symbol);
        }
        SymbolId::NIL
    }

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
        // Upstream's loop does not end when a target has no declarations and is not the resolved target: the guard ends it.
        let mut guard = LoopGuard::new();
        while a.sym(symbol).flags.intersects(SymbolFlags::ALIAS) {
            if !guard.turn() {
                self.loop_limit("resolveAliasWithDeprecationCheck");
                break;
            }
            let target = self.get_immediate_aliased_symbol(symbol);
            if !target.is_nil() {
                if target == target_symbol {
                    break;
                }
                let declarations = a.sym(target).declarations;
                if declarations.len() != 0 {
                    if self.is_deprecated_symbol(target) {
                        self.add_deprecated_suggestion(location, declarations, a.sym(target).name);
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

    // Gets combined flags of a `symbol` and all alias targets it resolves to. `resolveAlias` is typically recursive over chains of aliases, but stops mid-chain if an alias is merged with another exported symbol, e.g. with `export const a = 0;` in a.ts, `export { a } from "./a"; export type a = number;` in b.ts and `import { a } from "./b";` in c.ts, calling `resolveAlias` on the `a` in c.ts would stop at the merged symbol exported from b.ts, even though there is still more alias to resolve. Consequently, if we were trying to determine if the `a` in c.ts has a value meaning, looking at the flags on the local symbol and on the symbol returned by `resolveAlias` is not enough. Returns SymbolFlags.All if `symbol` is an alias that ultimately resolves to `unknown`; combined flags of all alias targets otherwise.
    pub fn get_symbol_flags(&mut self, symbol: SymbolId) -> SymbolFlags {
        self.get_symbol_flags_ex(symbol, false, false)
    }

    pub fn get_symbol_flags_ex(
        &mut self,
        symbol: SymbolId,
        exclude_type_only_meanings: bool,
        exclude_local_meanings: bool,
    ) -> SymbolFlags {
        let a = self.ast;
        let mut symbol = symbol;
        let mut seen_symbols: Set<SymbolId> = Set::default();
        let mut flags = SymbolFlags::NONE;
        if !exclude_local_meanings {
            flags = a.sym(symbol).flags;
        }
        while a.sym(symbol).flags.intersects(SymbolFlags::ALIAS) {
            if exclude_type_only_meanings && !self.get_type_only_alias_declaration(symbol).is_nil()
            {
                break;
            }
            let resolved = self.resolve_alias(symbol);
            let target = self.get_export_symbol_of_value_symbol_if_exported(resolved);
            if target == self.unknown_symbol {
                return SymbolFlags::ALL;
            }
            if a.sym(target).flags.intersects(SymbolFlags::ALIAS) {
                // Optimization - try to avoid creating or adding to `seenSymbols` if possible
                if target == symbol || seen_symbols.has(&target) {
                    break;
                }
                if seen_symbols.len() == 0 {
                    seen_symbols.add(symbol);
                }
                seen_symbols.add(target);
            }
            flags |= a.sym(target).flags;
            symbol = target;
        }
        flags
    }

    pub fn get_declaration_of_alias_symbol(&self, symbol: SymbolId) -> NodeId {
        let a = self.ast;
        find_last(a.sym(symbol).declarations.as_slice(), |declaration| {
            is_alias_symbol_declaration(a, declaration)
        })
    }
}

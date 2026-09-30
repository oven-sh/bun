// checker.go:13991-14168 (layer N-RESOLVE): the functions of 13991-14050: the resolved symbol of an identifier, the value or alias symbol of a reference, and the message for a name that is not found.
use crate::ast::{
    Kind, NodeId, SymbolFlags, SymbolId, is_call_expression, is_write_only_access, node_is_missing,
};
use crate::checker::Checker;
use crate::core::{if_else, or_else};
use crate::diagnostics::{self, MessageId};

impl<'a> Checker<'a> {
    pub fn get_resolved_symbol(&mut self, node: NodeId) -> SymbolId {
        let a = self.ast;
        let links = self.symbol_node_links.get(node);
        if self.symbol_node_links[links].resolved_symbol.is_nil() {
            let mut symbol = SymbolId::NIL;
            if !node_is_missing(a, node) {
                let name_not_found_message = self.get_cannot_find_name_diagnostic_for_name(node);
                symbol = self.resolve_name(
                    node,
                    a.text(node),
                    SymbolFlags::VALUE | SymbolFlags::EXPORT_VALUE,
                    name_not_found_message,
                    !is_write_only_access(a, node),
                    false,
                );
            }
            self.symbol_node_links[links].resolved_symbol = or_else(symbol, self.unknown_symbol);
        }
        self.symbol_node_links[links].resolved_symbol
    }

    pub fn get_resolved_symbol_or_nil(&mut self, node: NodeId) -> SymbolId {
        let links = self.symbol_node_links.get(node);
        self.symbol_node_links[links].resolved_symbol
    }

    pub fn get_referenced_value_or_alias_symbol(&mut self, reference: NodeId) -> SymbolId {
        let a = self.ast;
        let links = self.symbol_node_links.get(reference);
        let resolved_symbol = self.symbol_node_links[links].resolved_symbol;
        if !resolved_symbol.is_nil() && resolved_symbol != self.unknown_symbol {
            return resolved_symbol;
        }
        self.resolve_name(
            reference,
            a.text(reference),
            SymbolFlags::VALUE | SymbolFlags::EXPORT_VALUE | SymbolFlags::ALIAS,
            MessageId::NIL,
            false,
            false,
        )
    }

    pub fn get_cannot_find_name_diagnostic_for_name(&self, node: NodeId) -> MessageId {
        let a = self.ast;
        match a.text(node) {
            b"document" | b"console" => {
                diagnostics::CANNOT_FIND_NAME_0_DO_YOU_NEED_TO_CHANGE_YOUR_TARGET_LIBRARY_TRY_CHANGING_THE_LIB_COMPILER_OPTION_TO_INCLUDE_DOM
            }
            b"$" => if_else(
                self.compiler_options.uses_wildcard_types(),
                diagnostics::CANNOT_FIND_NAME_0_DO_YOU_NEED_TO_INSTALL_TYPE_DEFINITIONS_FOR_JQUERY_TRY_NPM_I_SAVE_DEV_TYPES_SLASHJQUERY,
                diagnostics::CANNOT_FIND_NAME_0_DO_YOU_NEED_TO_INSTALL_TYPE_DEFINITIONS_FOR_JQUERY_TRY_NPM_I_SAVE_DEV_TYPES_SLASHJQUERY_AND_THEN_ADD_JQUERY_TO_THE_TYPES_FIELD_IN_YOUR_TSCONFIG,
            ),
            b"beforeEach" | b"describe" | b"suite" | b"it" | b"test" => if_else(
                self.compiler_options.uses_wildcard_types(),
                diagnostics::CANNOT_FIND_NAME_0_DO_YOU_NEED_TO_INSTALL_TYPE_DEFINITIONS_FOR_A_TEST_RUNNER_TRY_NPM_I_SAVE_DEV_TYPES_SLASHJEST_OR_NPM_I_SAVE_DEV_TYPES_SLASHMOCHA,
                diagnostics::CANNOT_FIND_NAME_0_DO_YOU_NEED_TO_INSTALL_TYPE_DEFINITIONS_FOR_A_TEST_RUNNER_TRY_NPM_I_SAVE_DEV_TYPES_SLASHJEST_OR_NPM_I_SAVE_DEV_TYPES_SLASHMOCHA_AND_THEN_ADD_JEST_OR_MOCHA_TO_THE_TYPES_FIELD_IN_YOUR_TSCONFIG,
            ),
            b"process" | b"require" | b"Buffer" | b"module" | b"NodeJS" => if_else(
                self.compiler_options.uses_wildcard_types(),
                diagnostics::CANNOT_FIND_NAME_0_DO_YOU_NEED_TO_INSTALL_TYPE_DEFINITIONS_FOR_NODE_TRY_NPM_I_SAVE_DEV_TYPES_SLASHNODE,
                diagnostics::CANNOT_FIND_NAME_0_DO_YOU_NEED_TO_INSTALL_TYPE_DEFINITIONS_FOR_NODE_TRY_NPM_I_SAVE_DEV_TYPES_SLASHNODE_AND_THEN_ADD_NODE_TO_THE_TYPES_FIELD_IN_YOUR_TSCONFIG,
            ),
            b"Bun" => if_else(
                self.compiler_options.uses_wildcard_types(),
                diagnostics::CANNOT_FIND_NAME_0_DO_YOU_NEED_TO_INSTALL_TYPE_DEFINITIONS_FOR_BUN_TRY_NPM_I_SAVE_DEV_TYPES_SLASHBUN,
                diagnostics::CANNOT_FIND_NAME_0_DO_YOU_NEED_TO_INSTALL_TYPE_DEFINITIONS_FOR_BUN_TRY_NPM_I_SAVE_DEV_TYPES_SLASHBUN_AND_THEN_ADD_BUN_TO_THE_TYPES_FIELD_IN_YOUR_TSCONFIG,
            ),
            b"Map" | b"Set" | b"Promise" | b"ast.Symbol" | b"WeakMap" | b"WeakSet" | b"Iterator"
            | b"AsyncIterator" | b"SharedArrayBuffer" | b"Atomics" | b"AsyncIterable"
            | b"AsyncIterableIterator" | b"AsyncGenerator" | b"AsyncGeneratorFunction"
            | b"BigInt" | b"Reflect" | b"BigInt64Array" | b"BigUint64Array" => {
                diagnostics::CANNOT_FIND_NAME_0_DO_YOU_NEED_TO_CHANGE_YOUR_TARGET_LIBRARY_TRY_CHANGING_THE_LIB_COMPILER_OPTION_TO_1_OR_LATER
            }
            b"await" if is_call_expression(a, a.parent(node)) => {
                diagnostics::CANNOT_FIND_NAME_0_DID_YOU_MEAN_TO_WRITE_THIS_IN_AN_ASYNC_FUNCTION
            }
            _ => {
                if a.kind(a.parent(node)) == Kind::ShorthandPropertyAssignment {
                    return diagnostics::NO_VALUE_EXISTS_IN_SCOPE_FOR_THE_SHORTHAND_PROPERTY_0_EITHER_DECLARE_ONE_OR_PROVIDE_AN_INITIALIZER;
                }
                diagnostics::CANNOT_FIND_NAME_0
            }
        }
    }
}

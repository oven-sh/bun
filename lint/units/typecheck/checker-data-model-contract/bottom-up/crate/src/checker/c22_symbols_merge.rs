// checker.go 14170-14194 and 14440-14468 (c22_symbols_merge, layer S-MERGE): the symbols that a checker makes. A checker symbol lives in the open store of the node table and is the same record as a bound one.
use crate::ast::flags_generated::{CheckFlags, SymbolFlags};
use crate::checker::checker::Checker;
use crate::tscore::golang::Text;
use crate::tscore::ids::{SymbolId, SymbolTableId, TypeId};

impl<'a> Checker<'a> {
    pub fn new_symbol(&mut self, flags: SymbolFlags, name: Text<'a>) -> SymbolId {
        self.symbol_count += 1;
        self.ast.new_symbol(flags | SymbolFlags::TRANSIENT, name)
    }

    pub fn new_symbol_ex(
        &mut self,
        flags: SymbolFlags,
        name: Text<'a>,
        check_flags: CheckFlags,
    ) -> SymbolId {
        let result = self.new_symbol(flags, name);
        self.ast
            .update_symbol(result, |s| s.check_flags = check_flags);
        result
    }

    pub fn new_parameter(&mut self, name: Text<'a>, t: TypeId) -> SymbolId {
        let symbol = self.new_symbol(SymbolFlags::FUNCTION_SCOPED_VARIABLE, name);
        let links = self.value_symbol_links_get(symbol);
        self.value_symbol_links[links].resolved_type = t;
        symbol
    }

    pub fn new_property(&mut self, name: Text<'a>, t: TypeId) -> SymbolId {
        let symbol = self.new_symbol(SymbolFlags::PROPERTY, name);
        let links = self.value_symbol_links_get(symbol);
        self.value_symbol_links[links].resolved_type = t;
        symbol
    }

    // maps.Clone of a symbol table: nil for nil, else a new table with the entries in iteration order.
    pub fn clone_symbol_table(&mut self, table: SymbolTableId) -> SymbolTableId {
        if table.is_nil() {
            return SymbolTableId::NIL;
        }
        let result = self.ast.new_table();
        let mut position = 0;
        while let Some((name, symbol)) = self.ast.table_entry_at(table, position) {
            self.ast.table_set(result, name, symbol);
            position += 1;
        }
        result
    }

    pub fn clone_symbol(&mut self, symbol: SymbolId) -> SymbolId {
        let source = self.ast.sym(symbol);
        let result = self.new_symbol(source.flags, source.name);
        let members = self.clone_symbol_table(source.members);
        let exports = self.clone_symbol_table(source.exports);
        self.ast.update_symbol(result, |s| {
            // Force reallocation if anything is ever appended to declarations: a list is never appended to in place.
            s.declarations = source.declarations;
            s.parent = source.parent;
            s.value_declaration = source.value_declaration;
            s.members = members;
            s.exports = exports;
        });
        self.record_merged_symbol(result, symbol);
        result
    }

    pub fn get_merged_symbol(&self, symbol: SymbolId) -> SymbolId {
        if !symbol.is_nil() {
            let merged = self.merged_symbols.get(&symbol);
            if !merged.is_nil() {
                return merged;
            }
        }
        symbol
    }

    pub fn record_merged_symbol(&mut self, target: SymbolId, source: SymbolId) {
        let ok = self.merged_symbols.set(source, target);
        self.map_set(ok);
    }
}

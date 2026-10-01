// binder/binder.go:132-138, 369-371, 2520-2540. The binder owns its arenas until the file is frozen.
use crate::arena::Arena;
use crate::flags::SymbolFlags;
use crate::golang::{List, OrderedMap, SliceBuf, Text};
use crate::ids::*;
use crate::shims::Bump;
use crate::types::Symbol;

pub struct Binder<'p> {
    pub arena: &'p Bump,
    pub symbol_count: isize,
    pub symbols: Arena<SymbolId, Symbol<'p>>,
    pub symbol_tables: Arena<SymbolTableId, OrderedMap<Text<'p>, SymbolId>>,
    pub next_symbol_id: u64,
}

impl<'p> Binder<'p> {
    pub fn new_symbol(&mut self, flags: SymbolFlags, name: Text<'p>) -> SymbolId {
        self.symbol_count += 1;
        let result = self.symbols.alloc(Symbol::default());
        self.symbols[result].flags = flags;
        self.symbols[result].name = name;
        result
    }

    // ast.GetSymbolId while binding: the id is stored in the symbol and frozen with it.
    pub fn get_symbol_id(&mut self, symbol: SymbolId) -> u64 {
        if self.symbols[symbol].id == 0 {
            self.next_symbol_id += 1;
            self.symbols[symbol].id = u32::try_from(self.next_symbol_id).unwrap_or(u32::MAX);
        }
        u64::from(self.symbols[symbol].id)
    }

    pub fn get_symbol_name_for_private_identifier(
        &mut self,
        containing_class_symbol: SymbolId,
        description: &[u8],
    ) -> Text<'p> {
        let mut name = Vec::new();
        name.extend_from_slice(b"\xFE#");
        name.extend_from_slice(
            self.get_symbol_id(containing_class_symbol)
                .to_string()
                .as_bytes(),
        );
        name.push(b'@');
        name.extend_from_slice(description);
        self.arena.alloc_slice_copy(&name)
    }

    pub fn add_declaration_to_symbol(
        &mut self,
        symbol: SymbolId,
        node: NodeId,
        symbol_flags: SymbolFlags,
    ) {
        self.symbols[symbol].flags |= symbol_flags;
        // symbol.Declarations = append(symbol.Declarations, node)
        let mut declarations = SliceBuf::nil();
        declarations.extend(self.symbols[symbol].declarations);
        declarations.push(node);
        self.symbols[symbol].declarations =
            List::from_slice(self.arena.alloc_slice_copy(&declarations.items));
    }

    // symbolTable[name] = symbol
    pub fn declare(
        &mut self,
        symbol_table: SymbolTableId,
        name: Text<'p>,
        flags: SymbolFlags,
    ) -> SymbolId {
        let mut symbol = self.symbol_tables[symbol_table].get(&name);
        if symbol.is_nil() {
            symbol = self.new_symbol(SymbolFlags::NONE, name);
            let _ = self.symbol_tables[symbol_table].set(name, symbol);
        }
        self.symbols[symbol].flags |= flags;
        symbol
    }
}

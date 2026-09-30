// Port of internal/ast/symbol.go. A symbol is read by value through the tree context; a table is named by its id.
use crate::ast::checkflags::CheckFlags;
use crate::ast::file::{Bound, File};
use crate::ast::ids::{NodeId, SymbolId, SymbolTableId};
use crate::ast::modifierflags::ModifierFlags;
use crate::ast::open::{push, read, write};
use crate::ast::reader::Ast;
use crate::ast::symbolflags::SymbolFlags;
use crate::ast::utilities::is_private_identifier_class_element_declaration;
use crate::core::List;
use crate::internal::FaultKind;
use std::borrow::Cow;
use std::sync::atomic::Ordering;

// SymbolTable of upstream is a map. Here it is the id of one: the nil id is the nil map.
pub type SymbolTable = SymbolTableId;

// Symbol
#[derive(Clone, Copy, Default, Debug)]
pub struct Symbol<'a> {
    pub flags: SymbolFlags,
    // Non-zero only in transient symbols created by Checker
    pub check_flags: CheckFlags,
    pub name: &'a [u8],
    pub declarations: List<'a, NodeId>,
    pub value_declaration: NodeId,
    pub members: SymbolTable,
    pub exports: SymbolTable,
    pub parent: SymbolId,
    pub export_symbol: SymbolId,
}

impl Symbol<'_> {
    pub fn is_external_module(&self) -> bool {
        self.flags.intersects(SymbolFlags::MODULE) && self.name.first() == Some(&b'"')
    }

    pub fn is_static(&self, a: Ast<'_>) -> bool {
        if self.value_declaration.is_nil() {
            return false;
        }
        let modifier_flags = a.modifier_flags(self.value_declaration);
        modifier_flags.intersects(ModifierFlags::STATIC)
    }

    // See comment on `declareModuleMember` in `binder.go`.
    pub fn combined_local_and_export_symbol_flags(&self, a: Ast<'_>) -> SymbolFlags {
        if !self.export_symbol.is_nil() {
            return self.flags | a.sym(self.export_symbol).flags;
        }
        self.flags
    }
}

// Invalid UTF8 sequence, will never occur as IdentifierName
pub const INTERNAL_SYMBOL_NAME_PREFIX: &[u8] = b"\xFE";

pub const INTERNAL_SYMBOL_NAME_CALL: &[u8] = b"\xFEcall"; // Call signatures
pub const INTERNAL_SYMBOL_NAME_CONSTRUCTOR: &[u8] = b"\xFEconstructor"; // Constructor implementations
pub const INTERNAL_SYMBOL_NAME_NEW: &[u8] = b"\xFEnew"; // Constructor signatures
pub const INTERNAL_SYMBOL_NAME_INDEX: &[u8] = b"\xFEindex"; // Index signatures
pub const INTERNAL_SYMBOL_NAME_EXPORT_STAR: &[u8] = b"\xFEexport"; // Module export * declarations
pub const INTERNAL_SYMBOL_NAME_GLOBAL: &[u8] = b"\xFEglobal"; // Global self-reference
pub const INTERNAL_SYMBOL_NAME_MISSING: &[u8] = b"\xFEmissing"; // Indicates missing symbol
pub const INTERNAL_SYMBOL_NAME_TYPE: &[u8] = b"\xFEtype"; // Anonymous type literal symbol
pub const INTERNAL_SYMBOL_NAME_OBJECT: &[u8] = b"\xFEobject"; // Anonymous object literal declaration
pub const INTERNAL_SYMBOL_NAME_JSX_ATTRIBUTES: &[u8] = b"\xFEjsxAttributes"; // Anonymous JSX attributes object literal declaration
pub const INTERNAL_SYMBOL_NAME_CLASS: &[u8] = b"\xFEclass"; // Unnamed class expression
pub const INTERNAL_SYMBOL_NAME_FUNCTION: &[u8] = b"\xFEfunction"; // Unnamed function expression
pub const INTERNAL_SYMBOL_NAME_COMPUTED: &[u8] = b"\xFEcomputed"; // Computed property name declaration with dynamic name
pub const INTERNAL_SYMBOL_NAME_ASSIGNMENT_DECLARATION: &[u8] = b"\xFEassignment"; // Assignment declarations
pub const INTERNAL_SYMBOL_NAME_INSTANTIATION_EXPRESSION: &[u8] = b"\xFEinstantiationExpression"; // Instantiation expressions
pub const INTERNAL_SYMBOL_NAME_IMPORT_ATTRIBUTES: &[u8] = b"\xFEimportAttributes";
pub const INTERNAL_SYMBOL_NAME_EXPORT_EQUALS: &[u8] = b"export="; // Export assignment symbol
pub const INTERNAL_SYMBOL_NAME_DEFAULT: &[u8] = b"default"; // Default export symbol (technically not wholly internal, but included here for usability)
pub const INTERNAL_SYMBOL_NAME_THIS: &[u8] = b"this";
pub const INTERNAL_SYMBOL_NAME_MODULE_EXPORTS: &[u8] = b"module.exports";

pub fn symbol_name<'a>(a: Ast<'a>, symbol: SymbolId) -> &'a [u8] {
    let s = a.sym(symbol);
    if !s.value_declaration.is_nil()
        && is_private_identifier_class_element_declaration(a, s.value_declaration)
    {
        return a.text(a.name(s.value_declaration));
    }
    s.name
}

// EscapeAllInternalSymbolNames replaces internal symbol name markers ("\xFE") with "__".
pub fn escape_all_internal_symbol_names(name: &[u8]) -> Cow<'_, [u8]> {
    let mut escaped: Option<Vec<u8>> = None;
    for (at, &byte) in name.iter().enumerate() {
        if byte == 0xFE {
            escaped
                .get_or_insert_with(|| name.get(..at).unwrap_or(&[]).to_vec())
                .extend_from_slice(b"__");
        } else if let Some(out) = escaped.as_mut() {
            out.push(byte);
        }
    }
    match escaped {
        Some(escaped) => Cow::Owned(escaped),
        None => Cow::Borrowed(name),
    }
}

pub fn escape_internal_symbol_name(name: &[u8]) -> Cow<'_, [u8]> {
    if let Some(rest) = name.strip_prefix(INTERNAL_SYMBOL_NAME_PREFIX) {
        return Cow::Owned([b"__".as_slice(), rest].concat());
    }
    Cow::Borrowed(name)
}

// Converts a binder symbol name into its escaped "__String" form: an internal name becomes "__"-prefixed, and a user name that begins with "__" gains one more underscore.
pub fn escape_symbol_name(name: &[u8]) -> Cow<'_, [u8]> {
    if let Some(rest) = name.strip_prefix(INTERNAL_SYMBOL_NAME_PREFIX) {
        return Cow::Owned([b"__".as_slice(), rest].concat());
    }
    if name.starts_with(b"__") {
        return Cow::Owned([b"_".as_slice(), name].concat());
    }
    Cow::Borrowed(name)
}

pub(crate) fn hash_name(name: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for &byte in name {
        hash = (hash ^ u64::from(byte)).wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash ^ (hash >> 32)
}

// A table of this many entries or fewer is searched in order.
pub(crate) const LINEAR_TABLE: usize = 8;

// The buckets of a table with `len` entries: a power of two, at most half full.
pub(crate) fn index_size(len: usize) -> usize {
    (len * 2).next_power_of_two().max(16)
}

// Puts entry `position` into the buckets: each bucket holds a position plus one, 0 is empty.
pub(crate) fn index_insert(index: &mut [u32], hash: u64, position: usize) {
    let mask = index.len().wrapping_sub(1);
    let mut at = hash as usize & mask;
    for _ in 0..index.len() {
        match index.get_mut(at) {
            Some(slot) if *slot == 0 => {
                *slot = position as u32 + 1;
                return;
            }
            Some(_) => at = (at + 1) & mask,
            None => return,
        }
    }
}

// The position of the entry named `name`: `name_at` gives the name of an entry.
pub(crate) fn index_find<'n>(
    index: &[u32],
    name: &[u8],
    name_at: impl Fn(usize) -> Option<&'n [u8]>,
) -> Option<usize> {
    let mask = index.len().checked_sub(1)?;
    let mut at = hash_name(name) as usize & mask;
    for _ in 0..index.len() {
        let slot = *index.get(at)?;
        if slot == 0 {
            return None;
        }
        let position = slot as usize - 1;
        if name_at(position) == Some(name) {
            return Some(position);
        }
        at = (at + 1) & mask;
    }
    None
}

// The map behind a table that a binder or a checker makes: `for name, symbol := range` runs in insertion order.
#[derive(Clone, Default)]
pub struct SymbolMap<'a> {
    entries: Vec<(&'a [u8], SymbolId)>,
    index: Vec<u32>,
}

impl<'a> SymbolMap<'a> {
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    fn find(&self, name: &[u8]) -> Option<usize> {
        if self.index.is_empty() {
            return self.entries.iter().position(|entry| entry.0 == name);
        }
        index_find(&self.index, name, |position| {
            self.entries.get(position).map(|entry| entry.0)
        })
    }

    fn rebuild(&mut self) {
        self.index.clear();
        if self.entries.len() <= LINEAR_TABLE {
            return;
        }
        self.index.resize(index_size(self.entries.len()), 0);
        for (position, entry) in self.entries.iter().enumerate() {
            index_insert(&mut self.index, hash_name(entry.0), position);
        }
    }

    // `table[name]`
    pub fn get(&self, name: &[u8]) -> SymbolId {
        match self
            .find(name)
            .and_then(|position| self.entries.get(position))
        {
            Some(entry) => entry.1,
            None => SymbolId::NIL,
        }
    }

    // `table[name] = symbol`
    pub fn set(&mut self, name: &'a [u8], symbol: SymbolId) {
        if let Some(entry) = self
            .find(name)
            .and_then(|position| self.entries.get_mut(position))
        {
            entry.1 = symbol;
            return;
        }
        self.entries.push((name, symbol));
        if self.entries.len() <= LINEAR_TABLE {
            return;
        }
        if self.entries.len() * 2 > self.index.len() {
            self.rebuild();
        } else {
            index_insert(&mut self.index, hash_name(name), self.entries.len() - 1);
        }
    }

    // `delete(table, name)`
    pub fn delete(&mut self, name: &[u8]) {
        if let Some(position) = self.find(name) {
            self.entries.remove(position);
            self.rebuild();
        }
    }

    // The entry at a position of the insertion order.
    pub fn entry_at(&self, position: usize) -> Option<(&'a [u8], SymbolId)> {
        self.entries.get(position).copied()
    }
}

impl<'a> Ast<'a> {
    fn bound_symbol(file: &'a File, bound: &'a Bound, local: usize) -> Option<Symbol<'a>> {
        let record = bound.symbols.get(local).filter(|_| local != 0)?;
        Some(Symbol {
            flags: record.flags,
            check_flags: CheckFlags::NONE,
            name: file.name(bound, record.name),
            declarations: List::from_slice(bound.symbol_declarations(record)),
            value_declaration: record.value_declaration,
            members: record.members,
            exports: record.exports,
            parent: record.parent,
            export_symbol: record.export_symbol,
        })
    }

    // The symbol behind an id: a transient or binder symbol of the open store, or a symbol of a bound file. The nil symbol reads as the zero symbol.
    pub fn sym(self, symbol: SymbolId) -> Symbol<'a> {
        let found = if symbol.is_open() {
            read(&self.open.symbols, symbol.open_index(), |s| *s)
        } else {
            self.frozen
                .locate_bound(symbol.0)
                .and_then(|(file, bound, local)| Self::bound_symbol(file, bound, local))
        };
        found.unwrap_or_default()
    }

    // newSymbol of the binder and of the checker. The name lives as long as the context: a node text or a slice of the arena of the store.
    pub fn new_symbol(self, flags: SymbolFlags, name: &'a [u8]) -> SymbolId {
        let symbol = Symbol {
            flags,
            name,
            ..Symbol::default()
        };
        let index = push(&self.open.symbols, symbol);
        if index == 0 || push(&self.open.symbol_ids, 0) != index {
            self.fault(FaultKind::IdSpaceExhausted, "newSymbol", 0, 0);
            return SymbolId::NIL;
        }
        SymbolId::from_open_index(index)
    }

    // A write to a symbol of the open store. A symbol of a bound file is never written: upstream clones it first.
    pub fn update_symbol(self, symbol: SymbolId, f: impl FnOnce(&mut Symbol<'a>)) {
        if !symbol.is_open() {
            let kind = if symbol.is_nil() {
                FaultKind::NilWrite
            } else {
                FaultKind::WriteToFrozen
            };
            self.fault(kind, "Symbol", 0, symbol.0);
            return;
        }
        let Some(mut value) = read(&self.open.symbols, symbol.open_index(), |s| *s) else {
            self.fault(FaultKind::NilWrite, "Symbol", 0, symbol.0);
            return;
        };
        f(&mut value);
        write(&self.open.symbols, symbol.open_index(), |s| *s = value);
    }

    // ast.GetSymbolId of utilities.go: assigned at the first call, in the order of the calls.
    pub fn get_symbol_id(self, symbol: SymbolId) -> u64 {
        if symbol.is_open() {
            let index = symbol.open_index();
            return match read(&self.open.symbol_ids, index, |id| *id) {
                Some(0) => {
                    let id = self.open.ids.next_symbol_id();
                    write(&self.open.symbol_ids, index, |slot| *slot = id);
                    id
                }
                Some(id) => id,
                None => {
                    self.fault(FaultKind::NilRead, "GetSymbolId", 0, symbol.0);
                    0
                }
            };
        }
        let record = self
            .frozen
            .locate_bound(symbol.0)
            .and_then(|(_, bound, local)| bound.symbols.get(local).filter(|_| local != 0));
        let Some(record) = record else {
            self.fault(FaultKind::NilRead, "GetSymbolId", 0, symbol.0);
            return 0;
        };
        let id = record.id.load(Ordering::Relaxed);
        if id != 0 {
            return id;
        }
        // Worst case, we burn a few ids if we have to CAS.
        let id = self.open.ids.next_symbol_id();
        match record
            .id
            .compare_exchange(0, id, Ordering::Relaxed, Ordering::Relaxed)
        {
            Ok(_) => id,
            Err(existing) => existing,
        }
    }

    // `make(SymbolTable)`
    pub fn new_table(self) -> SymbolTable {
        let index = push(&self.open.tables, SymbolMap::default());
        if index == 0 {
            self.fault(FaultKind::IdSpaceExhausted, "SymbolTable", 0, 0);
            return SymbolTable::NIL;
        }
        SymbolTable::from_open_index(index)
    }

    // `table[name]`: the nil symbol when the name is absent or the table is nil.
    pub fn table_get(self, table: SymbolTable, name: &[u8]) -> SymbolId {
        if table.is_open() {
            return read(&self.open.tables, table.open_index(), |t| t.get(name))
                .unwrap_or(SymbolId::NIL);
        }
        match self.frozen.locate_bound(table.0) {
            Some((file, bound, local)) => file.table_lookup(bound, local, name),
            None => SymbolId::NIL,
        }
    }

    // `len(table)`
    pub fn table_len(self, table: SymbolTable) -> isize {
        if table.is_open() {
            return read(&self.open.tables, table.open_index(), |t| t.len()).unwrap_or(0) as isize;
        }
        match self.frozen.locate_bound(table.0) {
            Some((_, bound, local)) => bound.table_len(local) as isize,
            None => 0,
        }
    }

    // The entry at a position of the iteration order, for `for name, symbol := range table`.
    pub fn table_entry_at(
        self,
        table: SymbolTable,
        position: usize,
    ) -> Option<(&'a [u8], SymbolId)> {
        if table.is_open() {
            return read(&self.open.tables, table.open_index(), |t| {
                t.entry_at(position)
            })
            .flatten();
        }
        let (file, bound, local) = self.frozen.locate_bound(table.0)?;
        file.table_entry_at(bound, local, position)
    }

    fn table_write(self, table: SymbolTable, f: impl FnOnce(&mut SymbolMap<'a>)) {
        if table.is_open() && write(&self.open.tables, table.open_index(), f) {
            return;
        }
        let kind = if table.is_nil() {
            FaultKind::NilMapWrite
        } else {
            FaultKind::WriteToFrozen
        };
        self.fault(kind, "SymbolTable", 0, table.0);
    }

    // `table[name] = symbol`: only a table of the open store. The name lives as long as the context.
    pub fn table_set(self, table: SymbolTable, name: &'a [u8], symbol: SymbolId) {
        self.table_write(table, |t| t.set(name, symbol));
    }

    // `delete(table, name)`
    pub fn table_delete(self, table: SymbolTable, name: &[u8]) {
        if table.is_nil() {
            return;
        }
        self.table_write(table, |t| t.delete(name));
    }

    // `maps.Clone(table)`: the nil table for the nil table.
    pub fn table_clone(self, table: SymbolTable) -> SymbolTable {
        if table.is_nil() {
            return SymbolTable::NIL;
        }
        let clone = self.new_table();
        let mut position = 0;
        while let Some((name, symbol)) = self.table_entry_at(table, position) {
            self.table_set(clone, name, symbol);
            position += 1;
        }
        clone
    }
}

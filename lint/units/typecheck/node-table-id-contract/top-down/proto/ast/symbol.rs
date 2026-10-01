// What the binder leaves in a file: symbols, symbol tables, flow nodes and flow lists, as plain records.
// Every id is `first + index` of the file's block, like the node ids. Names are spans of `names`.
use crate::golang::{List, Text};
use crate::ids::{FlowListId, FlowNodeId, NodeId, SymbolId, SymbolTableId};

#[derive(Clone, Copy, Default)]
pub struct SymbolRec {
    pub flags: u32,
    pub name: (u32, u32),
    // A span of `BoundData::declarations`.
    pub declarations: (u32, u32),
    pub value_declaration: NodeId,
    pub members: SymbolTableId,
    pub exports: SymbolTableId,
    pub parent: SymbolId,
    pub export_symbol: SymbolId,
    // The number upstream calls the symbol id, when the binder asked for it (private names). 0: never asked.
    pub lazy_id: u64,
}

#[derive(Clone, Copy, Default)]
pub struct SymbolTableRec {
    // A span of `BoundData::entries`, in insertion order.
    pub entries: (u32, u32),
    // A span of `BoundData::index`: a power of two of buckets with entry index plus one, 0 for empty.
    pub index: (u32, u32),
}

#[derive(Clone, Copy, Default)]
pub struct FlowNodeRec {
    pub flags: u32,
    pub node: NodeId,
    pub antecedent: FlowNodeId,
    pub antecedents: FlowListId,
}

#[derive(Clone, Copy, Default)]
pub struct FlowListRec {
    pub flow: FlowNodeId,
    pub next: FlowListId,
}

#[derive(Default)]
pub struct BoundData {
    pub symbols: Vec<SymbolRec>,
    pub symbol_tables: Vec<SymbolTableRec>,
    pub entries: Vec<((u32, u32), SymbolId)>,
    pub index: Vec<u32>,
    pub flow_nodes: Vec<FlowNodeRec>,
    pub flow_lists: Vec<FlowListRec>,
    pub declarations: Vec<NodeId>,
    pub names: Vec<u8>,
    pub symbol_count: u32,
}

// A symbol as the checker reads it: the record with its name and its declarations resolved.
#[derive(Clone, Copy, Default)]
pub struct Symbol<'a> {
    pub flags: u32,
    pub name: Text<'a>,
    pub declarations: List<'a, NodeId>,
    pub value_declaration: NodeId,
    pub members: SymbolTableId,
    pub exports: SymbolTableId,
    pub parent: SymbolId,
    pub export_symbol: SymbolId,
}

fn hash_name(name: &[u8]) -> u64 {
    bun_wyhash::hash(name)
}

impl BoundData {
    pub fn id_count(&self) -> u32 {
        (self.symbols.len() as u32)
            .max(self.symbol_tables.len() as u32)
            .max(self.flow_nodes.len() as u32)
            .max(self.flow_lists.len() as u32)
    }
    pub fn heap_bytes(&self) -> usize {
        self.symbols.capacity() * std::mem::size_of::<SymbolRec>()
            + self.symbol_tables.capacity() * std::mem::size_of::<SymbolTableRec>()
            + self.entries.capacity() * 12
            + self.index.capacity() * 4
            + self.flow_nodes.capacity() * std::mem::size_of::<FlowNodeRec>()
            + self.flow_lists.capacity() * std::mem::size_of::<FlowListRec>()
            + self.declarations.capacity() * 4
            + self.names.capacity()
    }
    fn name(&self, span: (u32, u32)) -> &[u8] {
        self.names
            .get(span.0 as usize..(span.0 + span.1) as usize)
            .unwrap_or(&[])
    }
    pub fn push_name(&mut self, name: &[u8]) -> (u32, u32) {
        let start = self.names.len() as u32;
        self.names.extend_from_slice(name);
        (start, name.len() as u32)
    }
    // Adds a table with its entries in insertion order and builds its lookup index. `first` is the table's block.
    pub fn push_symbol_table(
        &mut self,
        first: u32,
        entries: &[(&[u8], SymbolId)],
    ) -> SymbolTableId {
        let start = self.entries.len() as u32;
        for (name, symbol) in entries {
            let span = self.push_name(name);
            self.entries.push((span, *symbol));
        }
        let buckets = (entries.len() * 2).next_power_of_two().max(2);
        let index_start = self.index.len();
        self.index.resize(index_start + buckets, 0);
        for (at, (name, _)) in entries.iter().enumerate() {
            let mut bucket = (hash_name(name) as usize) & (buckets - 1);
            loop {
                match self.index.get_mut(index_start + bucket) {
                    Some(slot) if *slot == 0 => {
                        *slot = at as u32 + 1;
                        break;
                    }
                    Some(_) => bucket = (bucket + 1) & (buckets - 1),
                    None => break,
                }
            }
        }
        self.symbol_tables.push(SymbolTableRec {
            entries: (start, entries.len() as u32),
            index: (index_start as u32, buckets as u32),
        });
        SymbolTableId(first + self.symbol_tables.len() as u32 - 1)
    }
    pub fn symbol<'a>(&'a self, first: u32, id: SymbolId) -> Option<Symbol<'a>> {
        let rec = self.symbols.get(id.0.wrapping_sub(first) as usize)?;
        let (start, len) = rec.declarations;
        Some(Symbol {
            flags: rec.flags,
            name: self.name(rec.name),
            declarations: match self
                .declarations
                .get(start as usize..(start + len) as usize)
            {
                Some(slice) if len != 0 => List::from_slice(slice),
                _ => List::NIL,
            },
            value_declaration: rec.value_declaration,
            members: rec.members,
            exports: rec.exports,
            parent: rec.parent,
            export_symbol: rec.export_symbol,
        })
    }
    // `table[name]`: NIL when the name is absent.
    pub fn symbol_table_get(&self, first: u32, table: SymbolTableId, name: &[u8]) -> SymbolId {
        let Some(rec) = self.symbol_tables.get(table.0.wrapping_sub(first) as usize) else {
            return SymbolId::NIL;
        };
        let (index_start, buckets) = (rec.index.0 as usize, rec.index.1 as usize);
        if buckets == 0 {
            return SymbolId::NIL;
        }
        let mut bucket = (hash_name(name) as usize) & (buckets - 1);
        for _ in 0..buckets {
            let Some(&slot) = self.index.get(index_start + bucket) else {
                break;
            };
            if slot == 0 {
                break;
            }
            if let Some(&(span, symbol)) = self.entries.get((rec.entries.0 + slot - 1) as usize) {
                if self.name(span) == name {
                    return symbol;
                }
            }
            bucket = (bucket + 1) & (buckets - 1);
        }
        SymbolId::NIL
    }
    pub fn symbol_table_len(&self, first: u32, table: SymbolTableId) -> u32 {
        self.symbol_tables
            .get(table.0.wrapping_sub(first) as usize)
            .map_or(0, |rec| rec.entries.1)
    }
    // The entry at a position of the insertion order.
    pub fn symbol_table_entry_at(
        &self,
        first: u32,
        table: SymbolTableId,
        position: u32,
    ) -> Option<(&[u8], SymbolId)> {
        let rec = self
            .symbol_tables
            .get(table.0.wrapping_sub(first) as usize)?;
        if position >= rec.entries.1 {
            return None;
        }
        let &(span, symbol) = self.entries.get((rec.entries.0 + position) as usize)?;
        Some((self.name(span), symbol))
    }
    pub fn flow_node(&self, first: u32, id: FlowNodeId) -> FlowNodeRec {
        self.flow_nodes
            .get(id.0.wrapping_sub(first) as usize)
            .copied()
            .unwrap_or_default()
    }
    pub fn flow_list(&self, first: u32, id: FlowListId) -> FlowListRec {
        self.flow_lists
            .get(id.0.wrapping_sub(first) as usize)
            .copied()
            .unwrap_or_default()
    }
    pub(crate) fn rebase(&mut self, delta: u32) {
        let shift = |v: u32| if v == 0 { 0 } else { v.wrapping_add(delta) };
        for s in &mut self.symbols {
            s.value_declaration.0 = shift(s.value_declaration.0);
            s.members.0 = shift(s.members.0);
            s.exports.0 = shift(s.exports.0);
            s.parent.0 = shift(s.parent.0);
            s.export_symbol.0 = shift(s.export_symbol.0);
        }
        for e in &mut self.entries {
            e.1.0 = shift(e.1.0);
        }
        for f in &mut self.flow_nodes {
            f.node.0 = shift(f.node.0);
            f.antecedent.0 = shift(f.antecedent.0);
            f.antecedents.0 = shift(f.antecedents.0);
        }
        for l in &mut self.flow_lists {
            l.flow.0 = shift(l.flow.0);
            l.next.0 = shift(l.next.0);
        }
        for d in &mut self.declarations {
            d.0 = shift(d.0);
        }
    }
}

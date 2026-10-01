// Ends the binding of a file: the objects of the binder's open store get their ids and move into the file, once.
use crate::ast::file::{
    Bound, File, FlowList, FlowNode, IdAllocator, NodeRecord, SymbolRecord, TableEntry,
    TableRecord, TextSpan, round_up_to_page,
};
use crate::ast::layout::SlotType;
use crate::ast::open::{Open, count};
use crate::ast::reader::{Ast, Frozen};
use crate::tscore::deps::hash_bytes;
use crate::tscore::golang::Map;
use crate::tscore::ids::{FlowListId, FlowNodeId, NodeId, OPEN_BIT, SymbolId, SymbolTableId};
use crate::tscore::stable::Arena;
use std::sync::atomic::Ordering;

#[derive(Debug, PartialEq, Eq)]
pub enum PublishError {
    AlreadyPublished,
    IdSpaceExhausted,
    StoreBusy,
    // A store that has a NodeList cannot be published: neither the binder nor the program layer makes one.
    HasLists,
}

// A table of this many entries or fewer is searched in order.
const LINEAR_TABLE: usize = 8;

// The names that the binder made itself, stored once each.
struct Names<'f> {
    file: &'f File,
    by_hash: Map<u64, u32>,
}

impl Names<'_> {
    fn span(&mut self, bound: &mut Bound, name: &[u8]) -> TextSpan {
        if name.is_empty() {
            return TextSpan::default();
        }
        // A name that the binder took from a node is a slice of the text of the file.
        let pool = self.file.text_bytes.as_ptr_range();
        let at = name.as_ptr().addr();
        if at >= pool.start.addr() && at + name.len() <= pool.end.addr() {
            return TextSpan {
                start: (at - pool.start.addr()) as u32,
                len: name.len() as u32,
            };
        }
        let hash = hash_bytes(name);
        let known = self.by_hash.get(&hash);
        let known_bytes = bound
            .text_bytes
            .get(known as usize..known as usize + name.len());
        if self.by_hash.get_ok(&hash).is_some() && known_bytes == Some(name) {
            return TextSpan {
                start: known | OPEN_BIT,
                len: name.len() as u32,
            };
        }
        let start = bound.text_bytes.len() as u32;
        bound.text_bytes.extend_from_slice(name);
        let _ = self.by_hash.set(hash, start);
        TextSpan {
            start: start | OPEN_BIT,
            len: name.len() as u32,
        }
    }
}

impl File {
    // BindSourceFile: runs `bind` once for this file, whatever the number of programs and threads that ask.
    pub fn bind_once(&self, ids: &IdAllocator, bind: impl for<'x> FnOnce(Ast<'x>)) -> &Bound {
        self.bound.get_or_init(|| {
            let arena = Arena::new();
            let open = Open::new(&arena, ids);
            let frozen = Frozen::of_binding(self);
            bind(Ast::new(&frozen, &open));
            // A file whose ids cannot be given is bound to nothing: every symbol of it reads as nil.
            self.collect(&open, ids).unwrap_or_default()
        })
    }

    // `open` is the store of the binder of this file. After this call nothing writes to the file.
    pub fn publish(&self, open: &Open<'_>, ids: &IdAllocator) -> Result<&Bound, PublishError> {
        if self.bound.get().is_some() {
            return Err(PublishError::AlreadyPublished);
        }
        let bound = self.collect(open, ids)?;
        if self.bound.set(bound).is_err() {
            return Err(PublishError::AlreadyPublished);
        }
        self.bound.get().ok_or(PublishError::AlreadyPublished)
    }

    // The objects of the open store as they are kept in the file, with the ids of a new range.
    fn collect(&self, open: &Open<'_>, ids: &IdAllocator) -> Result<Bound, PublishError> {
        let (
            Ok(nodes),
            Ok(texts),
            Ok(symbols),
            Ok(tables),
            Ok(flow_nodes),
            Ok(flow_lists),
            Ok(symbol_ids),
        ) = (
            open.nodes.try_borrow(),
            open.texts.try_borrow(),
            open.symbols.try_borrow(),
            open.tables.try_borrow(),
            open.flow_nodes.try_borrow(),
            open.flow_lists.try_borrow(),
            open.open_symbol_ids.try_borrow(),
        )
        else {
            return Err(PublishError::StoreBusy);
        };
        if count(&open.lists) != 0 {
            return Err(PublishError::HasLists);
        }
        let needed = count(&open.nodes)
            .max(count(&open.symbols))
            .max(count(&open.tables))
            .max(count(&open.flow_nodes))
            .max(count(&open.flow_lists));
        let span = needed
            .checked_add(1)
            .and_then(round_up_to_page)
            .ok_or(PublishError::IdSpaceExhausted)?;
        let base = ids.alloc(span).ok_or(PublishError::IdSpaceExhausted)?;
        // An id of the open store becomes an id of the file. Every other id is final already.
        let fix = |id: u32| {
            if id & OPEN_BIT != 0 {
                base + (id & !OPEN_BIT)
            } else {
                id
            }
        };
        let mut bound = Bound {
            base,
            span,
            ..Bound::default()
        };
        let mut names = Names {
            file: self,
            by_hash: Map::make(),
        };

        bound.records.push(NodeRecord::default());
        bound.flags.push(Default::default());
        bound.texts.push(TextSpan::default());
        for node in nodes.iter().skip(1) {
            let info = node.def.info();
            let data = bound.slots.len() as u32;
            for (index, slot) in info.slots.iter().enumerate() {
                let value = node.slots.get(index).copied().unwrap_or(0);
                let moved = match slot.ty {
                    SlotType::Text => {
                        let text = texts.get(value as usize).copied().unwrap_or(b"");
                        let start = bound.text_bytes.len() as u32;
                        bound.text_bytes.extend_from_slice(text);
                        bound.texts.push(TextSpan {
                            start,
                            len: text.len() as u32,
                        });
                        (bound.texts.len() - 1) as u32
                    }
                    SlotType::Node | SlotType::FlowNode | SlotType::FlowList => fix(value),
                    SlotType::NodeList | SlotType::ModifierList | SlotType::RawNodeList => value,
                    SlotType::Bool
                    | SlotType::Kind
                    | SlotType::TokenFlags
                    | SlotType::Int
                    | SlotType::TypeId => value,
                };
                bound.slots.push(moved);
            }
            bound.records.push(NodeRecord {
                loc: node.loc,
                parent: NodeId(fix(node.parent.0)),
                data,
                late: 0,
                kind: node.kind,
                def: node.def,
            });
            bound.flags.push(node.flags);
        }

        bound.symbols.push(SymbolRecord::default());
        for (index, symbol) in symbols.iter().enumerate().skip(1) {
            let declarations_start = bound.declarations.len() as u32;
            bound
                .declarations
                .extend(symbol.declarations.iter().map(|node| NodeId(fix(node.0))));
            let name = names.span(&mut bound, symbol.name);
            bound.symbols.push(SymbolRecord {
                flags: symbol.flags,
                name,
                declarations_start,
                declarations_len: symbol.declarations.len() as u32,
                value_declaration: NodeId(fix(symbol.value_declaration.0)),
                members: SymbolTableId(fix(symbol.members.0)),
                exports: SymbolTableId(fix(symbol.exports.0)),
                parent: SymbolId(fix(symbol.parent.0)),
                export_symbol: SymbolId(fix(symbol.export_symbol.0)),
                lazy_id: symbol_ids.get(index).copied().unwrap_or(0),
            });
        }
        bound.tables.push(TableRecord::default());
        for table in tables.iter().skip(1) {
            let entries_start = bound.table_entries.len() as u32;
            let len = table.len() as usize;
            let mut hashes = Vec::with_capacity(len);
            for position in 0..len {
                if let Some((name, symbol)) = table.entry_at(position) {
                    hashes.push(hash_bytes(name));
                    let name = names.span(&mut bound, name);
                    bound.table_entries.push(TableEntry {
                        name,
                        symbol: SymbolId(fix(symbol.0)),
                    });
                }
            }
            let mut record = TableRecord {
                entries_start,
                len: hashes.len() as u32,
                index_start: bound.table_index.len() as u32,
                index_len: 0,
            };
            if hashes.len() > LINEAR_TABLE {
                let size = (hashes.len() * 2).next_power_of_two();
                record.index_len = size as u32;
                let mut index = vec![0u32; size];
                for (position, hash) in hashes.iter().enumerate() {
                    let mut at = *hash as usize & (size - 1);
                    while index.get(at).is_some_and(|slot| *slot != 0) {
                        at = (at + 1) & (size - 1);
                    }
                    if let Some(slot) = index.get_mut(at) {
                        *slot = position as u32 + 1;
                    }
                }
                bound.table_index.extend_from_slice(&index);
            }
            bound.tables.push(record);
        }
        bound.flow_nodes.push(FlowNode::default());
        for flow in flow_nodes.iter().skip(1) {
            bound.flow_nodes.push(FlowNode {
                flags: flow.flags,
                node: NodeId(fix(flow.node.0)),
                antecedent: FlowNodeId(fix(flow.antecedent.0)),
                antecedents: FlowListId(fix(flow.antecedents.0)),
            });
        }
        bound.flow_lists.push(FlowList::default());
        for list in flow_lists.iter().skip(1) {
            bound.flow_lists.push(FlowList {
                flow: FlowNodeId(fix(list.flow.0)),
                next: FlowListId(fix(list.next.0)),
            });
        }
        bound.records.shrink_to_fit();
        bound.slots.shrink_to_fit();
        bound.text_bytes.shrink_to_fit();
        bound.declarations.shrink_to_fit();
        bound.table_entries.shrink_to_fit();
        bound.table_index.shrink_to_fit();

        // The fields that the binder wrote into the nodes of the file: every one is an id.
        for cell in &self.late {
            let value = cell.load(Ordering::Relaxed);
            if value & OPEN_BIT != 0 {
                cell.store(fix(value), Ordering::Relaxed);
            }
        }
        Ok(bound)
    }

    // A file that holds only the nodes of an open store: the nodes that a program makes beside its source files.
    pub fn of_open(open: &Open<'_>, ids: &IdAllocator) -> Result<File, PublishError> {
        let file = File::default();
        file.publish(open, ids)?;
        Ok(file)
    }
}

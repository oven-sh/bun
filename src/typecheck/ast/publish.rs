// Ends the binding of a file: the objects of the open store of the binder get their ids and become the bind result of the file, once.
use crate::ast::ast::PatternAmbientModule;
use crate::ast::diagnostic::DiagnosticStore;
use crate::ast::file::{
    Bound, File, IdAllocator, NodeRecord, SymbolRecord, TableEntry, TableRecord, TextSpan,
    round_up_to_page,
};
use crate::ast::flow::{FlowList, FlowNode};
use crate::ast::ids::{
    DiagnosticId, FlowListId, FlowNodeId, NodeId, OPEN_BIT, SymbolId, SymbolTableId,
};
use crate::ast::layout::SlotType;
use crate::ast::nodeflags::NodeFlags;
use crate::ast::open::{BindOverlay, Open, count};
use crate::ast::reader::{Ast, Frozen};
use crate::ast::stable::Arena;
use crate::ast::symbol::{LINEAR_TABLE, hash_name, index_find, index_insert, index_size};
use std::sync::atomic::AtomicU64;

#[derive(Debug, PartialEq, Eq)]
pub enum PublishError {
    AlreadyPublished,
    IdSpaceExhausted,
    StoreBusy,
    // A store that has a NodeList cannot be published: the binder makes none.
    HasLists,
}

// The names that the binder made itself, stored once each in the bytes of the bind result.
struct Names<'f> {
    file: &'f File,
    spans: Vec<TextSpan>,
    index: Vec<u32>,
}

impl Names<'_> {
    fn bytes<'b>(bound: &'b Bound, span: TextSpan) -> Option<&'b [u8]> {
        let start = span.start as usize;
        bound.text_bytes.get(start..start + span.len as usize)
    }

    fn span(&mut self, bound: &mut Bound, name: &[u8]) -> TextSpan {
        if name.is_empty() {
            return TextSpan::default();
        }
        // A name that the binder took from a node is a slice of the bytes of the file.
        if let Some(span) = self.file.span_of(name) {
            return span;
        }
        let known = index_find(&self.index, name, |position| {
            Self::bytes(bound, *self.spans.get(position)?)
        });
        let own = match known.and_then(|position| self.spans.get(position)) {
            Some(span) => *span,
            None => {
                let span = TextSpan {
                    start: bound.text_bytes.len() as u32,
                    len: name.len() as u32,
                };
                bound.text_bytes.extend_from_slice(name);
                self.spans.push(span);
                if self.spans.len() * 2 > self.index.len() {
                    self.index.clear();
                    self.index.resize(index_size(self.spans.len()), 0);
                    for (position, span) in self.spans.iter().enumerate() {
                        let hash = hash_name(Self::bytes(bound, *span).unwrap_or(&[]));
                        index_insert(&mut self.index, hash, position);
                    }
                } else {
                    index_insert(&mut self.index, hash_name(name), self.spans.len() - 1);
                }
                span
            }
        };
        TextSpan {
            start: own.start | OPEN_BIT,
            len: own.len,
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
            match self.collect(&open, ids) {
                Ok(bound) => bound,
                Err(_) => Bound {
                    faults: open.faults.snapshot(),
                    fault_count: open.faults.count(),
                    ..Bound::default()
                },
            }
        })
    }

    // `open` is the store of the binder of this file. After this call nothing writes about the file.
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

    // A file that holds only the objects of an open store: what a program makes beside its source files.
    pub fn of_open(open: &Open<'_>, ids: &IdAllocator) -> Result<File, PublishError> {
        let file = File::default();
        file.publish(open, ids)?;
        Ok(file)
    }

    // The objects of the open store as the bind result keeps them, with the ids of a new range.
    fn collect(&self, open: &Open<'_>, ids: &IdAllocator) -> Result<Bound, PublishError> {
        let (
            Ok(nodes),
            Ok(words),
            Ok(texts),
            Ok(symbols),
            Ok(symbol_ids),
            Ok(tables),
            Ok(flow_nodes),
            Ok(flow_lists),
            Ok(mut binding),
        ) = (
            open.nodes.try_borrow(),
            open.slots.try_borrow(),
            open.texts.try_borrow(),
            open.symbols.try_borrow(),
            open.symbol_ids.try_borrow(),
            open.tables.try_borrow(),
            open.flow_nodes.try_borrow(),
            open.flow_lists.try_borrow(),
            open.binding.try_borrow_mut(),
        )
        else {
            return Err(PublishError::StoreBusy);
        };
        if count(&open.lists) != 0 {
            return Err(PublishError::HasLists);
        }
        let needed = (nodes.len().saturating_sub(1) as u32)
            .max(symbols.len().saturating_sub(1) as u32)
            .max(tables.len().saturating_sub(1) as u32)
            .max(flow_nodes.len().saturating_sub(1) as u32)
            .max(flow_lists.len().saturating_sub(1) as u32);
        let span = needed
            .checked_add(1)
            .and_then(round_up_to_page)
            .ok_or(PublishError::IdSpaceExhausted)?;
        let base = ids.alloc(span).ok_or(PublishError::IdSpaceExhausted)?;
        // An id of the open store becomes an id of the bind result. Every other id is final already.
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
            spans: Vec::new(),
            index: Vec::new(),
        };

        bound.records.push(NodeRecord::default());
        bound.record_flags.push(NodeFlags::NONE);
        bound.texts.push(TextSpan::default());
        for node in nodes.iter().skip(1) {
            let info = node.rec.def.info();
            let data = bound.slots.len() as u32;
            for (index, slot) in info.slots.iter().enumerate() {
                let value = words
                    .get(node.rec.data as usize + index)
                    .copied()
                    .unwrap_or(0);
                let moved = match slot.ty {
                    SlotType::Text => {
                        let text = texts.get(value as usize).copied().unwrap_or(&[]);
                        let start = bound.text_bytes.len() as u32;
                        bound.text_bytes.extend_from_slice(text);
                        bound.texts.push(TextSpan {
                            start: start | OPEN_BIT,
                            len: text.len() as u32,
                        });
                        (bound.texts.len() - 1) as u32
                    }
                    SlotType::Node | SlotType::FlowNode | SlotType::FlowList => fix(value),
                    SlotType::NodeList
                    | SlotType::ModifierList
                    | SlotType::RawNodeList
                    | SlotType::Bool
                    | SlotType::Kind
                    | SlotType::TokenFlags
                    | SlotType::Int
                    | SlotType::Any => value,
                };
                bound.slots.push(moved);
            }
            bound.records.push(NodeRecord {
                loc: node.rec.loc,
                parent: NodeId(fix(node.rec.parent.0)),
                data,
                late: 0,
                kind: node.rec.kind,
                def: node.rec.def,
            });
            bound.record_flags.push(node.flags);
        }

        bound.symbols.push(SymbolRecord::default());
        for (index, symbol) in symbols.iter().enumerate().skip(1) {
            let declarations_start = bound.declarations.len() as u32;
            let declarations = symbol.declarations.as_slice();
            bound
                .declarations
                .extend(declarations.iter().map(|node| NodeId(fix(node.0))));
            let name = names.span(&mut bound, symbol.name);
            bound.symbols.push(SymbolRecord {
                flags: symbol.flags,
                name,
                declarations_start,
                declarations_len: declarations.len() as u32,
                value_declaration: NodeId(fix(symbol.value_declaration.0)),
                members: SymbolTableId(fix(symbol.members.0)),
                exports: SymbolTableId(fix(symbol.exports.0)),
                parent: SymbolId(fix(symbol.parent.0)),
                export_symbol: SymbolId(fix(symbol.export_symbol.0)),
                id: AtomicU64::new(symbol_ids.get(index).copied().unwrap_or(0)),
            });
        }

        bound.tables.push(TableRecord::default());
        for table in tables.iter().skip(1) {
            let entries_start = bound.table_entries.len() as u32;
            let mut hashes = Vec::with_capacity(table.len());
            for position in 0..table.len() {
                if let Some((name, symbol)) = table.entry_at(position) {
                    hashes.push(hash_name(name));
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
                let mut index = vec![0u32; index_size(hashes.len())];
                for (position, hash) in hashes.iter().enumerate() {
                    index_insert(&mut index, *hash, position);
                }
                record.index_len = index.len() as u32;
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

        // What the binder wrote about the nodes of the file and about its source file: every field of the binder is an id.
        if let Some(overlay) = binding.take() {
            let BindOverlay {
                flags,
                mut late,
                bind_diagnostics,
                bind_diagnostic_store,
                symbol_count,
                global_exports,
                pattern_ambient_modules,
                common_js_module_indicator,
            } = overlay;
            for value in &mut late {
                *value = fix(*value);
            }
            bound.flags = flags;
            bound.late = late;
            // The file of a bind diagnostic is the root of the file: the store of the binder holds no id of the open store.
            bound.bind_diagnostics = bind_diagnostics;
            bound.bind_diagnostic_store = bind_diagnostic_store;
            bound.file_symbol_count = symbol_count;
            bound.global_exports = SymbolTableId(fix(global_exports.0));
            bound.pattern_ambient_modules = pattern_ambient_modules
                .into_iter()
                .map(|module| PatternAmbientModule {
                    pattern: module.pattern,
                    symbol: SymbolId(fix(module.symbol.0)),
                })
                .collect();
            bound.common_js_module_indicator = NodeId(fix(common_js_module_indicator.0));
        }
        bound.faults = open.faults.snapshot();
        bound.fault_count = open.faults.count();

        bound.records.shrink_to_fit();
        bound.record_flags.shrink_to_fit();
        bound.slots.shrink_to_fit();
        bound.texts.shrink_to_fit();
        bound.text_bytes.shrink_to_fit();
        bound.symbols.shrink_to_fit();
        bound.declarations.shrink_to_fit();
        bound.tables.shrink_to_fit();
        bound.table_entries.shrink_to_fit();
        bound.table_index.shrink_to_fit();
        bound.flow_nodes.shrink_to_fit();
        bound.flow_lists.shrink_to_fit();
        Ok(bound)
    }
}

impl Ast<'_> {
    // A write of the binder about the source file that it binds. `file` is the root of that file.
    fn write_bound_file(self, file: NodeId, who: &'static str, f: impl FnOnce(&mut BindOverlay)) {
        let is_root = self
            .frozen
            .binding_file()
            .is_some_and(|binding| binding.source_file.root == file && !file.is_nil());
        if !is_root || self.overlay(f).is_none() {
            self.cannot_write(who, file.0, self.exists(file));
        }
    }

    // `file.SetBindDiagnostics(diagnostics)`: the file keeps the store of its binder, whose ids the diagnostics are.
    pub fn set_bind_diagnostics(
        self,
        file: NodeId,
        store: DiagnosticStore,
        diagnostics: Vec<DiagnosticId>,
    ) {
        self.write_bound_file(file, "SourceFile.BindDiagnostics", |overlay| {
            overlay.bind_diagnostic_store = store;
            overlay.bind_diagnostics = diagnostics;
        });
    }

    // `file.SymbolCount = count`
    pub fn set_symbol_count(self, file: NodeId, count: isize) {
        self.write_bound_file(file, "SourceFile.SymbolCount", |overlay| {
            overlay.symbol_count = count;
        });
    }

    // `file.PatternAmbientModules = modules`
    pub fn set_pattern_ambient_modules(self, file: NodeId, modules: Vec<PatternAmbientModule>) {
        self.write_bound_file(file, "SourceFile.PatternAmbientModules", |overlay| {
            overlay.pattern_ambient_modules = modules;
        });
    }

    // `file.GlobalExports = table`
    pub fn set_global_exports(self, file: NodeId, table: SymbolTableId) {
        self.write_bound_file(file, "SourceFile.GlobalExports", |overlay| {
            overlay.global_exports = table;
        });
    }

    // `file.CommonJSModuleIndicator = node`
    pub fn set_common_js_module_indicator(self, file: NodeId, node: NodeId) {
        self.write_bound_file(file, "SourceFile.CommonJSModuleIndicator", |overlay| {
            overlay.common_js_module_indicator = node;
        });
    }
}

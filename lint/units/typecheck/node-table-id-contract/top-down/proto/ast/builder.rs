// What a producer does with a context in Build mode.
//   1. Make nodes: with the factory (children first, as the reference's parser does), or with the raw calls below
//      (a node first, its fields later, by the Go name of the field), in any order.
//   2. Change them freely: flags, range, parent, any field; replace an element of a list by making a new list.
//      A node that ends up unreachable is dropped.
//   3. `finish`: the nodes that the root reaches become a table with the ids 1..n in the order of
//      ForEachChildAndJSDoc (a host, its JSDoc, its children), so two producers give the same table for one tree.
use crate::ast::ast_generated::{Def, SlotType, layout};
use crate::ast::context::AstContext;
use crate::ast::flags_generated::{ModifierFlags, NodeFlags};
use crate::ast::kind_generated::Kind;
use crate::ast::node_arena::ArenaMark;
use crate::ast::program::IdAllocator;
use crate::ast::table::{FileData, NodeTable};
use crate::core::TextRange;
use crate::ids::{ModifierListId, NodeId, NodeListId, SYNTH};
use crate::internal::FaultKind;

#[derive(Clone, Copy)]
pub enum RawValue<'t> {
    Node(NodeId),
    List(NodeListId),
    Text(&'t [u8]),
    Bool(bool),
    Kind(Kind),
    U32(u32),
}

impl<'a> AstContext<'a> {
    // A node of struct `def` with every field zero.
    pub fn raw_new_node(&self, def: Def, kind: Kind, loc: TextRange, flags: NodeFlags) -> NodeId {
        const ZEROS: [u32; crate::ast::ast_generated::MAX_SLOTS] =
            [0; crate::ast::ast_generated::MAX_SLOTS];
        let n = layout(def).slots.len();
        let node = self
            .arena
            .new_node(kind, def, ZEROS.get(..n).unwrap_or(&[]));
        if node.is_nil() {
            self.log
                .record(FaultKind::IdSpaceExhausted, "raw_new_node", kind as u32);
            return node;
        }
        self.set_loc(node, loc);
        self.set_flags(node, flags);
        node
    }
    // Sets the field with this Go name. False when the struct has no such field or the value has the wrong type.
    pub fn raw_set(&self, node: NodeId, field: &[u8], value: RawValue<'_>) -> bool {
        let def = self.def(node);
        let fields = layout(def).slots;
        let Some(slot) = fields.iter().position(|f| f.name.as_bytes() == field) else {
            return false;
        };
        let Some(desc) = fields.get(slot) else {
            return false;
        };
        let word = match (desc.ty, value) {
            (SlotType::Node, RawValue::Node(n)) => n.0,
            (
                SlotType::NodeList | SlotType::ModifierList | SlotType::RawNodeList,
                RawValue::List(l),
            ) => l.0,
            (SlotType::Text, RawValue::Text(t)) => self.arena.new_text(t),
            (SlotType::Bool, RawValue::Bool(b)) => u32::from(b),
            (SlotType::Kind, RawValue::Kind(k)) => k as u32,
            (SlotType::TokenFlags | SlotType::I32 | SlotType::Any, RawValue::U32(v)) => v,
            _ => return false,
        };
        self.set_field(node, def, slot, word, "raw_set");
        true
    }
    // A list with its range. An empty slice makes an empty list, which is not the nil list.
    pub fn raw_new_list(&self, nodes: &[NodeId], loc: TextRange) -> NodeListId {
        self.arena.new_list(nodes, loc, ModifierFlags::empty())
    }
    pub fn raw_new_modifier_list(
        &self,
        nodes: &[NodeId],
        loc: TextRange,
        flags: ModifierFlags,
    ) -> ModifierListId {
        ModifierListId(self.arena.new_list(nodes, loc, flags).0)
    }
    // Attaches the JSDoc nodes of a host. The producer sets the flag HasJSDoc on the host.
    pub fn raw_set_jsdoc(&self, host: NodeId, jsdoc: &[NodeId]) {
        let list = self.raw_new_list(jsdoc, crate::core::undefined_text_range());
        if host.0 & SYNTH == 0 || !self.arena.set_jsdoc(host, list) {
            self.log
                .record(FaultKind::WriteToBoundObject, "JSDoc", host.0);
        }
    }

    // For a producer that makes nodes it may give up: nothing made after the mark may be referenced after the rewind.
    pub fn mark(&self) -> ArenaMark {
        self.arena.mark()
    }
    pub fn rewind(&self, mark: ArenaMark) {
        self.arena.rewind(mark);
    }
    // Ends the construction of a file: a local table (ids from 1) for the binder. The context can be dropped afterwards.
    pub fn finish(&'a self, root: NodeId, source_text: Vec<u8>, file: FileData) -> NodeTable {
        let (mut table, new_id) = self.finish_into(1, &[root], false);
        let map = |old: NodeId| -> NodeId {
            if old.0 & SYNTH == 0 {
                return NodeId::NIL;
            }
            NodeId(new_id.get((old.0 & !SYNTH) as usize).copied().unwrap_or(0))
        };
        let count = table.file.node_count;
        table.source_text = source_text;
        table.file = file;
        table.file.node_count = count;
        table.file.external_module_indicator = map(table.file.external_module_indicator);
        table.file.common_js_module_indicator = map(table.file.common_js_module_indicator);
        table
    }
    // Ends the construction of nodes that no file holds (the import specifiers a program makes for a file).
    // The table is frozen at once: there is nothing to bind. A parent or a child may be a node of a frozen file.
    pub fn finish_synthetic(&'a self, roots: &[NodeId], ids: &IdAllocator) -> Option<NodeTable> {
        let base = ids.alloc(self.arena.node_count().max(self.arena.list_count()))?;
        let (mut table, _) = self.finish_into(base, roots, true);
        table.frozen = true;
        Some(table)
    }

    fn finish_into(
        &'a self,
        first: u32,
        roots: &[NodeId],
        allow_foreign: bool,
    ) -> (NodeTable, Vec<u32>) {
        let arena_nodes = self.arena.node_count() as usize;
        // new_id[arena index] is the id of a reached node in the new table, 0 otherwise.
        let mut new_id: Vec<u32> = vec![0; arena_nodes + 1];
        let mut order: Vec<(NodeId, u32)> = Vec::with_capacity(arena_nodes);
        let mut stack: Vec<(NodeId, u32)> = roots.iter().rev().map(|root| (*root, 0)).collect();
        let mut children: Vec<NodeId> = Vec::new();
        while let Some((node, parent)) = stack.pop() {
            if node.0 & SYNTH == 0 {
                if !allow_foreign {
                    self.log.record(
                        FaultKind::BuilderMisuse,
                        "finish: a node of another table",
                        node.0,
                    );
                }
                continue;
            }
            let Some(slot) = new_id.get_mut((node.0 & !SYNTH) as usize) else {
                self.log
                    .record(FaultKind::BuilderMisuse, "finish: an unknown node", node.0);
                continue;
            };
            if *slot != 0 {
                self.log.record(
                    FaultKind::SharedNode,
                    "finish: a node with two parents",
                    node.0,
                );
                continue;
            }
            let id = first + order.len() as u32;
            *slot = id;
            order.push((node, parent));
            children.clear();
            children.extend(self.jsdoc_of(node).iter());
            node.for_each_child(self, &mut |child| {
                children.push(child);
                false
            });
            stack.extend(children.iter().rev().map(|child| (*child, id)));
        }

        let mut table = NodeTable::with_first(first);
        table.recs.reserve_exact(order.len());
        let map_node = |old: u32| -> u32 {
            if old & SYNTH == 0 {
                return if allow_foreign { old } else { 0 };
            }
            new_id.get((old & !SYNTH) as usize).copied().unwrap_or(0)
        };
        let mut new_list: Vec<u32> = vec![0; self.arena.list_count() as usize + 1];
        let mut new_text: Vec<u32> = Vec::new();
        let mut items: Vec<NodeId> = Vec::new();
        let mut words: Vec<u32> = Vec::new();
        let mut map_list = |table: &mut NodeTable, old: u32| -> u32 {
            if old == 0 {
                return 0;
            }
            let index = (old & !SYNTH) as usize;
            match new_list.get(index) {
                Some(&found) if found != 0 => return found,
                Some(_) => {}
                None => return 0,
            }
            items.clear();
            items.extend(
                self.arena
                    .list_nodes(old)
                    .unwrap_or(&[])
                    .iter()
                    .map(|n| NodeId(map_node(n.0))),
            );
            let loc = self.arena.list_loc(old).unwrap_or_default();
            let flags = self.arena.list_modifier_flags(old).unwrap_or_default();
            let id = table.push_list(loc, &items, flags).0;
            if let Some(slot) = new_list.get_mut(index) {
                *slot = id;
            }
            id
        };
        for &(node, structural_parent) in &order {
            let (def, slots) = self.slots_any(node);
            let fields = layout(def).slots;
            words.clear();
            for (field, &value) in fields.iter().zip(slots.iter()) {
                words.push(match field.ty {
                    SlotType::Node => map_node(value),
                    SlotType::NodeList | SlotType::ModifierList | SlotType::RawNodeList => {
                        map_list(&mut table, value)
                    }
                    SlotType::Text => {
                        let at = value as usize;
                        if new_text.len() <= at {
                            new_text.resize(at + 1, u32::MAX);
                        }
                        match new_text.get(at).copied() {
                            Some(found) if found != u32::MAX => found,
                            _ => {
                                let handle = table.push_text(self.arena.text(value));
                                if let Some(slot) = new_text.get_mut(at) {
                                    *slot = handle;
                                }
                                handle
                            }
                        }
                    }
                    _ => value,
                });
            }
            // The parent a producer set wins when it is in the tree. Otherwise the parent is the node that holds it.
            let explicit = map_node(self.parent(node).0);
            let parent = if explicit != 0 {
                explicit
            } else {
                structural_parent
            };
            table.push_node(
                self.kind(node),
                def,
                self.flags(node),
                self.loc(node),
                NodeId(parent),
                &words,
            );
        }
        for (index, &(node, _)) in order.iter().enumerate() {
            let list = self.arena.jsdoc_of(node);
            if !list.is_nil() {
                let mapped = map_list(&mut table, list.0);
                table
                    .jsdoc
                    .push((NodeId(first + index as u32), NodeListId(mapped)));
            }
        }
        table.shrink();
        table.root = NodeId(roots.first().map_or(0, |root| map_node(root.0)));
        table.file.node_count = order.len() as u32;
        (table, new_id)
    }
}

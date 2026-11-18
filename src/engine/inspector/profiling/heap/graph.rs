//! What a collection has found.

use core::cell::Cell;
use core::ffi::c_void;

use bun_engine_text::{AllocError, Identifier, PropertyName, StringImpl, StringRef};
use bun_engine_vm::heap::{DeferCollection, Heap, HeapGraphSink, RootReason};
use bun_engine_vm::{AsciiLiteral, FastHashMap, Gc, JsCell};
use hashbrown::hash_map::Entry;

use super::Identifiers;

/// Into the nodes.
pub(super) type NodeIndex = u32;

#[derive(Clone, Copy)]
struct Node {
    cell: usize,
    identifier: u32,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum EdgeKind {
    Root(RootReason),
    Internal,
    Property,
    Index,
    Variable,
}

#[derive(Clone, Copy)]
pub(super) struct Edge {
    /// Means nothing for a root.
    pub(super) from: NodeIndex,
    pub(super) to: NodeIndex,
    /// The index of an element, or an index into the names.
    pub(super) detail: u32,
    pub(super) kind: EdgeKind,
}

#[derive(Default)]
struct Findings {
    nodes: Vec<Node>,
    edges: Vec<Edge>,
    names: Vec<Identifier>,
    labels: FastHashMap<NodeIndex, StringRef>,
    wrapped_objects: FastHashMap<NodeIndex, usize>,
    opaque_root_reasons: FastHashMap<NodeIndex, AsciiLiteral>,
}

struct Builder<'a> {
    findings: Findings,
    node_indices: FastHashMap<usize, NodeIndex>,
    name_indices: FastHashMap<Identifier, u32>,
    earlier: Identifiers,
    last_identifier: &'a Cell<u32>,
    has_overflowed: bool,
}

impl Builder<'_> {
    fn index_of(&mut self, cell: Gc<JsCell>) -> Option<NodeIndex> {
        let nodes = &mut self.findings.nodes;
        self.has_overflowed = self.has_overflowed
            || nodes.len() == NodeIndex::MAX as usize
            || nodes.try_reserve(1).is_err()
            || self.node_indices.try_reserve(1).is_err();
        if self.has_overflowed {
            return None;
        }
        let cell = cell.address();
        Some(match self.node_indices.entry(cell) {
            Entry::Occupied(entry) => *entry.get(),
            Entry::Vacant(entry) => {
                let identifier = self.earlier.get(&cell).copied().unwrap_or_else(|| {
                    self.last_identifier.update(|last| last.wrapping_add(1));
                    self.last_identifier.get()
                });
                nodes.push(Node { cell, identifier });
                *entry.insert(nodes.len() as NodeIndex - 1)
            }
        })
    }

    fn add_edge(&mut self, from: Gc<JsCell>, to: Gc<JsCell>, kind: EdgeKind, detail: u32) {
        let (Some(from), Some(to)) = (self.index_of(from), self.index_of(to)) else {
            return;
        };
        self.has_overflowed = self.findings.edges.try_reserve(1).is_err();
        if !self.has_overflowed {
            self.findings.edges.push(Edge {
                from,
                to,
                detail,
                kind,
            });
        }
    }

    fn add_named_edge(
        &mut self,
        from: Gc<JsCell>,
        to: Gc<JsCell>,
        kind: EdgeKind,
        name: PropertyName<'_>,
    ) {
        let index = self.name_indices.get(&name).copied().unwrap_or_else(|| {
            let index = self.findings.names.len() as u32;
            self.findings.names.push(name.to_identifier());
            self.name_indices.insert(name.to_identifier(), index);
            index
        });
        self.add_edge(from, to, kind, index);
    }
}

impl HeapGraphSink for Builder<'_> {
    fn node(&mut self, cell: Gc<JsCell>) {
        self.index_of(cell);
    }

    fn root(&mut self, cell: Gc<JsCell>, reason: RootReason) {
        self.add_edge(cell, cell, EdgeKind::Root(reason), 0);
    }

    fn edge(&mut self, from: Gc<JsCell>, to: Gc<JsCell>) {
        if from != to {
            self.add_edge(from, to, EdgeKind::Internal, 0);
        }
    }

    fn property_edge(&mut self, from: Gc<JsCell>, to: Gc<JsCell>, name: PropertyName<'_>) {
        self.add_named_edge(from, to, EdgeKind::Property, name);
    }

    fn variable_edge(&mut self, from: Gc<JsCell>, to: Gc<JsCell>, name: PropertyName<'_>) {
        self.add_named_edge(from, to, EdgeKind::Variable, name);
    }

    fn index_edge(&mut self, from: Gc<JsCell>, to: Gc<JsCell>, index: u32) {
        self.add_edge(from, to, EdgeKind::Index, index);
    }

    fn label(&mut self, cell: Gc<JsCell>, label: &StringImpl) {
        if !label.is_empty()
            && let Some(node) = self.index_of(cell)
        {
            self.findings.labels.insert(node, StringRef::retain(label));
        }
    }

    fn wrapped_object(&mut self, cell: Gc<JsCell>, wrapped: *const c_void) {
        if let Some(node) = self.index_of(cell) {
            self.findings.wrapped_objects.insert(node, wrapped.addr());
        }
    }

    fn opaque_root_reason(&mut self, cell: Gc<JsCell>, reason: AsciiLiteral) {
        if !reason.as_str().is_empty()
            && let Some(node) = self.index_of(cell)
        {
            self.findings.opaque_root_reasons.insert(node, reason);
        }
    }
}

/// The cells are alive for as long as it is.
pub(super) struct Graph<'a> {
    findings: Findings,
    _deferral: DeferCollection<'a>,
}

impl<'a> Graph<'a> {
    /// With the identifiers of all nodes. `earlier` are those of cells that were alive before.
    pub(super) fn collect(
        heap: &'a Heap,
        earlier: Identifiers,
        last_identifier: &Cell<u32>,
    ) -> Result<(Graph<'a>, Identifiers), AllocError> {
        let mut builder = Builder {
            findings: Findings::default(),
            node_indices: FastHashMap::default(),
            name_indices: FastHashMap::default(),
            earlier,
            last_identifier,
            has_overflowed: false,
        };
        let _deferral = heap.collect_and_analyze(&mut builder);
        if builder.has_overflowed {
            return Err(AllocError);
        }
        let (findings, mut identifiers) = (builder.findings, builder.node_indices);
        for index in identifiers.values_mut() {
            *index = findings.nodes[*index as usize].identifier;
        }
        let graph = Graph {
            findings,
            _deferral,
        };
        Ok((graph, identifiers))
    }

    pub(super) fn node_count(&self) -> usize {
        self.findings.nodes.len()
    }

    pub(super) fn nodes(&self) -> impl Iterator<Item = (NodeIndex, Gc<JsCell>)> {
        let nodes = (0..).zip(&self.findings.nodes);
        // SAFETY: it has survived the last collection.
        nodes.map(|(index, node)| (index, unsafe { Gc::from_address(node.cell) }))
    }

    pub(super) fn identifier(&self, node: NodeIndex) -> u32 {
        self.findings.nodes[node as usize].identifier
    }

    pub(super) fn take_edges(&mut self) -> Vec<Edge> {
        core::mem::take(&mut self.findings.edges)
    }

    pub(super) fn names(&self) -> &[Identifier] {
        &self.findings.names
    }

    pub(super) fn label(&self, node: NodeIndex) -> Option<&StringRef> {
        self.findings.labels.get(&node)
    }

    /// The address, or zero.
    pub(super) fn wrapped_object(&self, node: NodeIndex) -> usize {
        let wrapped = self.findings.wrapped_objects.get(&node);
        wrapped.copied().unwrap_or(0)
    }

    pub(super) fn opaque_root_reason(&self, node: NodeIndex) -> Option<&'static str> {
        Some(self.findings.opaque_root_reasons.get(&node)?.as_str())
    }
}

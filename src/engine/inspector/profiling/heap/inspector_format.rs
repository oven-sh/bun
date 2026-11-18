//! `HeapSnapshotData` of the inspector protocol: flat lists of numbers, some of which are indices into lists of strings.

use core::fmt::Write;

use bun_engine_text::{AllocError, StringBuilder, StringRef};
use bun_engine_vm::heap::RootReason;
use bun_engine_vm::{FastHashSet, Gc, JsCell, JsFunction, Shape, display_name};

use super::graph::{Edge, EdgeKind, Graph, NodeIndex};
use super::names::{as_plain_object, class_or_constructor_name};
use super::string_table::StringTable;
use crate::profiling::AnyRealm;
use crate::profiling::json::JsonWriter;

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum SnapshotKind {
    Inspector,
    /// Also has labels, addresses and why each root is one.
    GcDebugging,
}

const IS_INTERNAL: u64 = 1 << 0;
const IS_PLAIN_OBJECT: u64 = 1 << 1;
const ROOT_IDENTIFIER: u32 = 0;

fn describe(reason: RootReason) -> &'static str {
    match reason {
        RootReason::None => "None",
        RootReason::ProtectedValues => "ProtectedValues",
        RootReason::StrongHandles => "StrongHandles",
        RootReason::StrongReferences => "StrongReferences",
        RootReason::Exceptions => "VMExceptions",
        RootReason::Debugger => "Debugger",
        RootReason::ExecutingCode => "JITStubRoutines",
        RootReason::WeakSets => "WeakSets",
        RootReason::Output => "Output",
        RootReason::Embedder => "DOMGCOutput",
    }
}

fn label(graph: &Graph<'_>, node: NodeIndex, cell: Gc<JsCell>) -> StringRef {
    if let Some(label) = graph.label(node) {
        label.clone()
    } else if let Some(function) = cell.downcast::<JsFunction>() {
        display_name(&function)
    } else if let Some(shape) = cell.downcast::<Shape>() {
        StringRef::from_literal(shape.class().name())
    } else {
        StringRef::empty()
    }
}

/// The identifier, the size, the class and the flags of each. Returns which nodes are there.
fn write_nodes(
    out: &mut StringBuilder,
    realms: &mut AnyRealm<'_>,
    graph: &Graph<'_>,
    mut labels: Option<&mut StringTable>,
    includes: &dyn Fn(Gc<JsCell>) -> bool,
) -> Result<Vec<bool>, AllocError> {
    let mut classes = StringTable::starting_with("<root>");
    let mut is_included = Vec::new();
    (is_included.try_reserve_exact(graph.node_count())).map_err(|_| AllocError)?;
    out.raw(br#","nodes":[0,0,0,0"#);
    if labels.is_some() {
        out.raw(br#",0,"0x0","0x0""#);
    }
    for (node, cell) in graph.nodes() {
        is_included.push(includes(cell));
        if !is_included[node as usize] {
            continue;
        }
        let is_value = cell.is_string() || cell.is_bigint();
        let mut flags = 0;
        if as_plain_object(cell).is_some() {
            flags |= IS_PLAIN_OBJECT;
        }
        if !is_value && cell.shape().global().is_none() {
            flags |= IS_INTERNAL;
        }
        let class = classes.index_of(class_or_constructor_name(realms, cell))?;
        let (identifier, size) = (graph.identifier(node), cell.estimated_size(realms));
        out.raw(b",");
        out.integers(&[identifier.into(), size as u64, class.into(), flags]);
        if let Some(labels) = &mut labels {
            let label = labels.index_of(label(graph, node, cell))?;
            let (address, wrapped) = (cell.address(), graph.wrapped_object(node));
            let _ = write!(out, r#",{label},"{address:#x}","{wrapped:#x}""#);
        }
    }
    out.raw(br#"],"nodeClassNames":["#);
    classes.write(out);
    out.raw(b"]");
    Ok(is_included)
}

/// Where it comes from and goes to, the type, and the name or the index.
fn write_edges(out: &mut StringBuilder, graph: &Graph<'_>, edges: &mut [Edge]) {
    let source = |edge: &Edge| match edge.kind {
        EdgeKind::Root(_) => ROOT_IDENTIFIER,
        _ => graph.identifier(edge.from),
    };
    edges.sort_unstable_by_key(source);
    out.raw(br#","edges":["#);
    out.separated(&*edges, |out, edge| {
        let kind = match edge.kind {
            EdgeKind::Root(_) | EdgeKind::Internal => 0,
            EdgeKind::Property => 1,
            EdgeKind::Index => 2,
            EdgeKind::Variable => 3,
        };
        let (from, to) = (source(edge), graph.identifier(edge.to));
        out.integers(&[from.into(), to.into(), kind, edge.detail.into()]);
    });
    out.raw(br#"],"edgeTypes":["Internal","Property","Index","Variable"],"edgeNames":["#);
    out.separated(graph.names(), |out, name| out.string(name.name().text()));
    out.raw(b"]");
}

/// With the first reason that was given for each: what holds a cell by itself comes before what follows from others.
fn first_roots(edges: &[Edge]) -> Vec<(NodeIndex, RootReason)> {
    let mut seen = FastHashSet::default();
    let roots = edges.iter().filter_map(|edge| match edge.kind {
        EdgeKind::Root(reason) => seen.insert(edge.to).then_some((edge.to, reason)),
        _ => None,
    });
    roots.collect()
}

pub(super) fn write(
    realms: &mut AnyRealm<'_>,
    mut graph: Graph<'_>,
    kind: SnapshotKind,
    includes: &dyn Fn(Gc<JsCell>) -> bool,
) -> Result<StringRef, AllocError> {
    let mut out = StringBuilder::new();
    let mut labels = match kind {
        SnapshotKind::Inspector => None,
        SnapshotKind::GcDebugging => Some(StringTable::starting_with("")),
    };
    out.raw(match kind {
        SnapshotKind::Inspector => br#"{"version":3,"type":"Inspector""#,
        SnapshotKind::GcDebugging => br#"{"version":3,"type":"GCDebugging""#,
    });
    let is_included = write_nodes(&mut out, realms, &graph, labels.as_mut(), includes)?;
    let mut edges = graph.take_edges();
    edges.retain(|edge| is_included[edge.from as usize] && is_included[edge.to as usize]);
    let roots = labels.as_ref().map_or_default(|_| first_roots(&edges));
    write_edges(&mut out, &graph, &mut edges);
    if let Some(mut labels) = labels {
        out.raw(br#","roots":["#);
        for (index, (node, reason)) in roots.into_iter().enumerate() {
            let reason = labels.index_of(StringRef::from_literal(describe(reason)))?;
            let detail = graph.opaque_root_reason(node).unwrap_or_default();
            let detail = labels.index_of(StringRef::from_literal(detail))?;
            out.raw(if index == 0 { b"" } else { b"," });
            out.integers(&[graph.identifier(node).into(), reason.into(), detail.into()]);
        }
        out.raw(br#"],"labels":["#);
        labels.write(&mut out);
        out.raw(b"]");
    }
    out.raw(b"}");
    out.finish()
}

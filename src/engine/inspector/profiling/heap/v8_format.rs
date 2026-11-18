//! The `.heapsnapshot` files of Chrome DevTools.

use bun_engine_text::{AllocError, StringRef, Text};
use bun_engine_vm::heap::RootReason;
use bun_engine_vm::{
    CellType, Environment, Gc, InternalFunction, JsCell, JsFunction, JsString, JsSymbol,
    RegExpObject,
};

use super::graph::{self, EdgeKind, Graph, NodeIndex};
use super::names::{class_name, class_or_constructor_name};
use super::string_table::StringTable;
use crate::profiling::AnyRealm;
use crate::profiling::json::JsonWriter;

const META: &str = concat!(
    r#"{"snapshot":{"meta":{"#,
    r#""node_fields":["type","name","id","self_size","edge_count","trace_node_id","detachedness"],"#,
    r#""node_types":[["hidden","array","string","object","code","closure","regexp","number","native","synthetic","#,
    r#""concatenated string","sliced string","symbol","bigint","object shape"],"#,
    r#""string","number","number","number","number","number"],"#,
    r#""edge_fields":["type","name_or_index","to_node"],"#,
    r#""edge_types":[["context","element","property","internal","hidden","shortcut","weak"],"#,
    r#""string_or_number","node"],"#,
    r#""trace_function_info_fields":["function_id","name","script_name","script_id","line","column"],"#,
    r#""trace_node_fields":["id","function_info_index","count","size","children"],"#,
    r#""sample_fields":["timestamp_us","last_assigned_id"],"#,
    r#""location_fields":["object_index","script_id","line","column"]},"#,
);
const NO_TRACES: &str = concat!(
    "\"trace_function_infos\":[],\n",
    "\"trace_tree\": [],\n",
    "\"samples\":[],\n",
    "\"locations\":[],\n",
);
const FIELDS_PER_NODE: u64 = 7;

/// Positions in `node_types`.
#[derive(Clone, Copy)]
enum NodeType {
    Hidden = 0,
    String = 2,
    Object = 3,
    Code = 4,
    Closure = 5,
    RegExp = 6,
    Native = 8,
    Synthetic = 9,
    ConcatenatedString = 10,
    SlicedString = 11,
    Symbol = 12,
    BigInt = 13,
    ObjectShape = 14,
}

/// Positions in `edge_types`.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum EdgeType {
    Context,
    Element,
    Property,
    Internal,
    Hidden,
    Shortcut,
    Weak,
}

/// What the program reaches is measured from here, and what only the collector knows from the next.
const ROOT: u32 = 0;
const GC_ROOTS: u32 = 1;
const SYNTHETIC_NODES: u32 = 2;

const LONGEST_NAME: usize = 1024;
const LONGEST_ROPE_TO_READ: u32 = 16384;

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct Edge {
    from: u32,
    kind: EdgeType,
    to: u32,
    detail: u32,
}

impl From<graph::Edge> for Edge {
    fn from(edge: graph::Edge) -> Edge {
        let mut from = edge.from + SYNTHETIC_NODES;
        let kind = match edge.kind {
            EdgeKind::Root(reason) => {
                from = GC_ROOTS;
                match reason {
                    RootReason::WeakSets => EdgeType::Weak,
                    RootReason::Debugger => EdgeType::Hidden,
                    _ => EdgeType::Internal,
                }
            }
            EdgeKind::Internal => EdgeType::Internal,
            EdgeKind::Property => EdgeType::Property,
            EdgeKind::Index => EdgeType::Element,
            EdgeKind::Variable => EdgeType::Context,
        };
        Edge {
            from,
            kind,
            to: edge.to + SYNTHETIC_NODES,
            detail: edge.detail,
        }
    }
}

fn node_type(cell: Gc<JsCell>) -> NodeType {
    if let Some(string) = cell.downcast::<JsString>() {
        return match (string.is_rope(), string.is_unresolved_substring()) {
            (_, true) => NodeType::SlicedString,
            (true, _) => NodeType::ConcatenatedString,
            _ => NodeType::String,
        };
    }
    if cell.as_object().is_some_and(|object| object.is_callable()) {
        return NodeType::Closure;
    }
    match cell.cell_type() {
        CellType::Shape => NodeType::ObjectShape,
        CellType::NativeExecutable
        | CellType::ProgramExecutable
        | CellType::ModuleExecutable
        | CellType::EvalExecutable
        | CellType::FunctionExecutable
        | CellType::CodeBlock
        | CellType::GetterSetter
        | CellType::CustomGetterSetter
        | CellType::SourceCode => NodeType::Code,
        CellType::BigInt => NodeType::BigInt,
        CellType::Symbol => NodeType::Symbol,
        CellType::RegExpObject => NodeType::RegExp,
        other if other >= CellType::FIRST_EMBEDDER_TYPE => NodeType::Native,
        other if other.is_object() || cell.is::<Environment>() => NodeType::Object,
        _ => NodeType::Hidden,
    }
}

fn truncated(name: &StringRef) -> StringRef {
    StringRef::substring(name, 0..name.len().min(LONGEST_NAME))
}

fn content_of(string: &JsString) -> StringRef {
    if let Some(view) = string.try_view() {
        let text = view.text();
        StringRef::from_text(text.slice(0..text.len().min(LONGEST_NAME)))
    } else if string.len() > LONGEST_ROPE_TO_READ {
        StringRef::from_literal("(concatenated string)")
    } else {
        string.to_string_without_resolving()
    }
}

/// Empty if there is nothing to say but the class.
fn own_name(cell: Gc<JsCell>) -> StringRef {
    let join = |parts: &[Text<'_>]| StringRef::try_concat(parts).unwrap_or_default();
    if let Some(string) = cell.downcast::<JsString>() {
        content_of(&string)
    } else if cell.cell_type() == CellType::Date {
        StringRef::from_literal("Date")
    } else if let Some(object) = cell.downcast::<RegExpObject>() {
        object.regexp().to_literal_text()
    } else if let Some(symbol) = cell.downcast::<JsSymbol>() {
        match symbol.symbol().description() {
            Some(text) if !text.is_empty() => {
                join(&[Text::from_ascii("Symbol("), text, Text::from_ascii(")")])
            }
            _ => StringRef::empty(),
        }
    } else if cell.is::<Environment>() {
        // The prefix keeps it out of the statistics of what the program has made.
        join(&[Text::from_ascii("system / "), class_name(&cell).text()])
    } else if let Some(function) = cell.downcast::<JsFunction>() {
        function.name()
    } else if let Some(function) = cell.downcast::<InternalFunction>() {
        function.name()
    } else {
        StringRef::empty()
    }
}

fn node_name(
    realms: &mut AnyRealm<'_>,
    graph: &Graph<'_>,
    node: NodeIndex,
    cell: Gc<JsCell>,
) -> StringRef {
    let name = graph.label(node).cloned().unwrap_or_else(|| own_name(cell));
    if name.is_empty() {
        return class_or_constructor_name(realms, cell);
    }
    name
}

/// By where they come from, without duplicates.
fn sorted_edges(graph: &mut Graph<'_>) -> Result<Vec<Edge>, AllocError> {
    let mut edges: Vec<Edge> = graph.take_edges().into_iter().map(Edge::from).collect();
    let from_root = |kind, to| Edge {
        from: ROOT,
        kind,
        to,
        detail: 0,
    };
    let globals = (graph.nodes())
        .filter(|(_, cell)| cell.cell_type() == CellType::GlobalObject)
        .map(|(node, _)| from_root(EdgeType::Shortcut, node + SYNTHETIC_NODES));
    for edge in globals.chain([from_root(EdgeType::Element, GC_ROOTS)]) {
        edges.try_reserve(1).map_err(|_| AllocError)?;
        edges.push(edge);
    }
    edges.sort_unstable();
    edges.dedup();
    let hidden = edges.iter_mut().filter(|it| it.kind == EdgeType::Hidden);
    for (index, edge) in (0..).zip(hidden) {
        edge.detail = index;
    }
    Ok(edges)
}

pub(super) fn write<W: JsonWriter>(
    realms: &mut AnyRealm<'_>,
    mut graph: Graph<'_>,
) -> Result<W::Output, AllocError> {
    let edges = sorted_edges(&mut graph)?;
    let (mut out, mut strings) = (W::default(), StringTable::starting_with(""));
    out.raw(META.as_bytes());
    out.raw(br#""node_count":"#);
    out.integer(graph.node_count() as u64 + u64::from(SYNTHETIC_NODES));
    out.raw(br#","edge_count":"#);
    out.integer(edges.len() as u64);
    out.raw(br#","trace_function_count":0},"nodes":["#);

    let mut uncounted = edges.as_slice();
    let mut write_node = |out: &mut W, node: u32, kind, name: u32, identifier: u64, size: usize| {
        let edge_count = uncounted.iter().take_while(|it| it.from == node).count();
        uncounted = &uncounted[edge_count..];
        out.raw(if node == ROOT { b"" } else { b"," });
        let (kind, size, edge_count) = (kind as u64, size as u64, edge_count as u64);
        out.integers(&[kind, name.into(), identifier, size, edge_count, 0, 0]);
    };
    for (node, name) in [(ROOT, ""), (GC_ROOTS, "(GC roots)")] {
        let name = strings.index_of(StringRef::from_literal(name))?;
        let identifier = u64::from(node) + 1;
        write_node(&mut out, node, NodeType::Synthetic, name, identifier, 0);
    }
    for (node, cell) in graph.nodes() {
        let name = strings.index_of(truncated(&node_name(realms, &graph, node, cell)))?;
        let identifier = u64::from(graph.identifier(node)) + u64::from(SYNTHETIC_NODES);
        let (kind, size) = (node_type(cell), cell.estimated_size(realms));
        write_node(
            &mut out,
            node + SYNTHETIC_NODES,
            kind,
            name,
            identifier,
            size,
        );
    }

    out.raw(b"],\n\"edges\":[");
    let names = (graph.names().iter()).map(|name| strings.index_of(truncated(name.string())));
    let names = names.collect::<Result<Vec<u32>, AllocError>>()?;
    out.separated(edges, |out, edge| {
        let detail = match edge.kind {
            EdgeType::Context | EdgeType::Property => names[edge.detail as usize],
            _ => edge.detail,
        };
        let to = u64::from(edge.to) * FIELDS_PER_NODE;
        out.integers(&[edge.kind as u64, detail.into(), to]);
    });
    out.raw(b"],\n");
    out.raw(NO_TRACES.as_bytes());
    out.raw(br#""strings":["#);
    strings.write(&mut out);
    out.raw(b"]\n}\n");
    out.finish()
}

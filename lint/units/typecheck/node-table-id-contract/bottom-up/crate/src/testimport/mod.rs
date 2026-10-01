// Loads a tree that TypeScript dumped as JSON (dump version 1) through the FileBuilder, as a producer does.
pub mod json;

use crate::ast::ast_generated::{Def, NodeFactory};
use crate::ast::builder::FileBuilder;
use crate::ast::factory::NodeSink;
use crate::ast::file::{File, IdAllocator, SourceFileData};
use crate::ast::flags_generated::NodeFlags;
use crate::ast::kind_generated::Kind;
use crate::ast::layout::SlotType;
use crate::tscore::ids::NodeId;
use crate::tscore::text::TextRange;
use json::Json;
use std::time::Instant;

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum ImportError {
    Json(json::JsonError),
    Version,
    Shape(&'static str),
    IdSpaceExhausted,
}

#[derive(Default, Debug, Clone)]
pub struct ImportStats {
    pub files: u32,
    pub dump_nodes: u32,
    pub made_nodes: u32,
    pub unknown_kinds: u32,
    // Children, lists and properties of the dump that no slot of the definition took.
    pub unmapped_children: u32,
    pub unmapped_lists: u32,
    pub unmapped_attrs: u32,
    pub source_texts: u32,
    pub copied_texts: u32,
    // Nanoseconds spent in the JSON reader, in the builder and in `finish`.
    pub json_ns: u64,
    pub build_ns: u64,
    pub finish_ns: u64,
    pub first_unmapped: Vec<u8>,
    // The kind names of the dump that are no kind of the port.
    pub unknown_kind_names: Vec<Vec<u8>>,
    // Distinct `Kind.property` that no slot took, with their count. At most 32 are kept.
    pub unmapped: Vec<(Vec<u8>, u32)>,
}

impl ImportStats {
    fn lost(&mut self, kind: Kind, prop: &[u8]) {
        let mut key = kind.name().as_bytes().to_vec();
        key.push(b'.');
        key.extend_from_slice(prop);
        if let Some(entry) = self.unmapped.iter_mut().find(|entry| entry.0 == key) {
            entry.1 += 1;
        } else if self.unmapped.len() < 32 {
            self.unmapped.push((key, 1));
        }
    }
}

// The bits of ts.NodeFlags (TypeScript 6.0) that the parser sets, with the flag of the port.
const TS_NODE_FLAGS: [(u32, NodeFlags); 19] = [
    (1 << 0, NodeFlags::LET),
    (1 << 1, NodeFlags::CONST),
    (1 << 2, NodeFlags::USING),
    (1 << 3, NodeFlags::NESTED_NAMESPACE),
    (1 << 6, NodeFlags::OPTIONAL_CHAIN),
    (1 << 8, NodeFlags::CONTAINS_THIS),
    (1 << 13, NodeFlags::DISALLOW_IN_CONTEXT),
    (1 << 14, NodeFlags::YIELD_CONTEXT),
    (1 << 15, NodeFlags::DECORATOR_CONTEXT),
    (1 << 16, NodeFlags::AWAIT_CONTEXT),
    (1 << 17, NodeFlags::DISALLOW_CONDITIONAL_TYPES_CONTEXT),
    (1 << 18, NodeFlags::THIS_NODE_HAS_ERROR),
    (1 << 19, NodeFlags::JAVA_SCRIPT_FILE),
    (1 << 20, NodeFlags::THIS_NODE_OR_ANY_SUB_NODES_HAS_ERROR),
    (1 << 22, NodeFlags::POSSIBLY_CONTAINS_DYNAMIC_IMPORT),
    (1 << 23, NodeFlags::POSSIBLY_CONTAINS_IMPORT_META),
    (1 << 24, NodeFlags::JSDOC),
    (1 << 25, NodeFlags::AMBIENT),
    (1 << 26, NodeFlags::IN_WITH_STATEMENT),
];

fn node_flags(ts: u32) -> NodeFlags {
    let mut flags = NodeFlags::NONE;
    for (bit, flag) in TS_NODE_FLAGS {
        if ts & bit != 0 {
            flags |= flag;
        }
    }
    flags
}

// A property name of TypeScript against a member name of _scripts/ast.json.
fn same_member(go: &str, ts: &[u8]) -> bool {
    let go = go.as_bytes();
    match (go.split_first(), ts.split_first()) {
        (Some((a, rest_a)), Some((b, rest_b))) => a.to_ascii_lowercase() == *b && rest_a == rest_b,
        _ => false,
    }
}

fn takes(go: &str, ts: &[u8]) -> bool {
    same_member(go, ts)
        || (go == "PostfixToken" && (ts == b"questionToken" || ts == b"exclamationToken"))
        || (go == "TokenFlags" && (ts == b"$tokenFlags" || ts == b"numericLiteralFlags"))
        || (go == "Comment" && ts == b"comment")
        || (go == "DefaultType" && ts == b"default")
}

struct DumpFile<'d> {
    nodes: &'d [i64],
    lists: &'d [i64],
    attrs: &'d [i64],
    kinds: &'d [Kind],
    props: &'d [&'d [u8]],
    strings: &'d [&'d [u8]],
    text: &'d [u8],
}

impl DumpFile<'_> {
    fn node_field(&self, node: usize, field: usize) -> i64 {
        self.nodes.get(node * 8 + field).copied().unwrap_or(-1)
    }
    fn prop(&self, index: i64) -> &[u8] {
        usize::try_from(index)
            .ok()
            .and_then(|i| self.props.get(i))
            .copied()
            .unwrap_or(b"")
    }
}

// The text as a slice of the source when the source has it where the node ends.
fn text_slot(
    builder: &mut FileBuilder,
    dump: &DumpFile<'_>,
    text: &[u8],
    end: i64,
    stats: &mut ImportStats,
) -> u32 {
    for back in [0usize, 1] {
        let Some(stop) = usize::try_from(end).ok().and_then(|e| e.checked_sub(back)) else {
            continue;
        };
        let Some(start) = stop.checked_sub(text.len()) else {
            continue;
        };
        if !text.is_empty() && dump.text.get(start..stop) == Some(text) {
            stats.source_texts += 1;
            return builder.source_text_slot(start as u32, text.len() as u32);
        }
    }
    stats.copied_texts += 1;
    builder.text_slot(text)
}

fn import_file(
    dump: &DumpFile<'_>,
    data: SourceFileData,
    ids: &IdAllocator,
    stats: &mut ImportStats,
) -> Option<File> {
    let started = Instant::now();
    let count = dump.nodes.len() / 8;
    let mut builder = FileBuilder::new(dump.text);
    // The children and the lists of each node, in the order of the dump.
    let mut first_child = vec![usize::MAX; count];
    let mut last_child = vec![usize::MAX; count];
    let mut next_sibling = vec![usize::MAX; count];
    for child in 1..count {
        let Ok(parent) = usize::try_from(dump.node_field(child, 4)) else {
            continue;
        };
        match last_child.get(parent).copied() {
            Some(usize::MAX) => {
                if let Some(slot) = first_child.get_mut(parent) {
                    *slot = child;
                }
            }
            Some(last) => {
                if let Some(slot) = next_sibling.get_mut(last) {
                    *slot = child;
                }
            }
            None => continue,
        }
        if let Some(slot) = last_child.get_mut(parent) {
            *slot = child;
        }
    }
    let list_count = dump.lists.len() / 5;
    let mut first_list = vec![usize::MAX; count];
    let mut next_list = vec![usize::MAX; list_count];
    for list in (0..list_count).rev() {
        let Ok(owner) = usize::try_from(dump.lists.get(list * 5).copied().unwrap_or(-1)) else {
            continue;
        };
        if let (Some(first), Some(next)) = (first_list.get_mut(owner), next_list.get_mut(list)) {
            *next = *first;
            *first = list;
        }
    }
    let mut attr_start = vec![0usize; count + 1];
    {
        let mut at = 0usize;
        for (node, start) in attr_start.iter_mut().enumerate() {
            while dump
                .attrs
                .get(at * 4)
                .is_some_and(|owner| (*owner as usize) < node)
            {
                at += 1;
            }
            *start = at;
        }
    }

    let mut made = vec![NodeId::NIL; count];
    let mut children: Vec<(usize, bool)> = Vec::new();
    let mut lists: Vec<(usize, bool)> = Vec::new();
    let mut items: Vec<NodeId> = Vec::new();
    let mut slots: Vec<u32> = Vec::new();
    let mut jsdoc: Vec<NodeId> = Vec::new();
    for node in (0..count).rev() {
        let kind = usize::try_from(dump.node_field(node, 0))
            .ok()
            .and_then(|k| dump.kinds.get(k))
            .copied()
            .unwrap_or(Kind::Unknown);
        let pos = dump.node_field(node, 1);
        let end = dump.node_field(node, 2);
        let prop = dump.prop(dump.node_field(node, 5));
        let (main, second) = Def::of_kind(kind);
        let in_token_position =
            prop == b"modifiers" || prop.ends_with(b"Token") || prop.ends_with(b"Modifier");
        let def = if second != Def::None && in_token_position {
            second
        } else {
            main
        };
        if kind == Kind::Unknown || def == Def::None {
            stats.unknown_kinds += 1;
            continue;
        }
        children.clear();
        let mut child = first_child.get(node).copied().unwrap_or(usize::MAX);
        while child != usize::MAX {
            children.push((child, false));
            child = next_sibling.get(child).copied().unwrap_or(usize::MAX);
        }
        lists.clear();
        let mut list = first_list.get(node).copied().unwrap_or(usize::MAX);
        while list != usize::MAX {
            lists.push((list, false));
            list = next_list.get(list).copied().unwrap_or(usize::MAX);
        }
        let attrs_from = attr_start.get(node).copied().unwrap_or(0);
        let attrs_to = attr_start.get(node + 1).copied().unwrap_or(attrs_from);
        let mut attr_used = 0u64;

        let info = def.info();
        slots.clear();
        for slot in info.slots {
            let mut value = 0u32;
            match slot.ty {
                SlotType::Node => {
                    for entry in children.iter_mut() {
                        let (index, used) = *entry;
                        if !used
                            && dump.node_field(index, 6) < 0
                            && takes(slot.name, dump.prop(dump.node_field(index, 5)))
                        {
                            value = made.get(index).map_or(0, |id| id.0);
                            entry.1 = true;
                            break;
                        }
                    }
                }
                SlotType::NodeList | SlotType::ModifierList | SlotType::RawNodeList => {
                    for entry in lists.iter_mut() {
                        let (index, used) = *entry;
                        let record = dump.lists.get(index * 5..index * 5 + 5).unwrap_or(&[]);
                        if used
                            || !takes(slot.name, dump.prop(record.get(1).copied().unwrap_or(-1)))
                        {
                            continue;
                        }
                        entry.1 = true;
                        items.clear();
                        for child in children.iter_mut() {
                            if dump.node_field(child.0, 6) == index as i64 {
                                child.1 = true;
                                if let Some(id) = made.get(child.0).filter(|id| !id.is_nil()) {
                                    items.push(*id);
                                }
                            }
                        }
                        let id = if slot.ty == SlotType::ModifierList {
                            builder.new_modifier_list(&items).as_node_list()
                        } else {
                            builder.new_node_list(&items)
                        };
                        let loc = TextRange::new(
                            record.get(2).copied().unwrap_or(-1) as i32,
                            record.get(3).copied().unwrap_or(-1) as i32,
                        );
                        builder.set_list_loc(id, loc);
                        value = id.0;
                        break;
                    }
                }
                SlotType::Text
                | SlotType::Bool
                | SlotType::Kind
                | SlotType::TokenFlags
                | SlotType::Int => {
                    for at in attrs_from..attrs_to {
                        let record = dump.attrs.get(at * 4..at * 4 + 4).unwrap_or(&[]);
                        let bit = 1u64 << ((at - attrs_from) & 63);
                        if attr_used & bit != 0
                            || !takes(slot.name, dump.prop(record.get(1).copied().unwrap_or(-1)))
                        {
                            continue;
                        }
                        let raw = record.get(3).copied().unwrap_or(0);
                        let ty = record.get(2).copied().unwrap_or(-1);
                        value = match (slot.ty, ty) {
                            (SlotType::Text, 2) => {
                                let text = usize::try_from(raw)
                                    .ok()
                                    .and_then(|i| dump.strings.get(i))
                                    .copied()
                                    .unwrap_or(b"");
                                text_slot(&mut builder, dump, text, end, stats)
                            }
                            (SlotType::Bool, 0) => u32::from(raw != 0),
                            (SlotType::Kind, 1) => usize::try_from(raw)
                                .ok()
                                .and_then(|k| dump.kinds.get(k))
                                .map_or(0, |k| *k as u32),
                            (SlotType::TokenFlags | SlotType::Int, 3) => raw as u32,
                            _ => continue,
                        };
                        attr_used |= bit;
                        break;
                    }
                }
                SlotType::TypeId | SlotType::FlowNode | SlotType::FlowList => {}
            }
            slots.push(value);
        }
        // A JSDoc comment that TypeScript keeps as a string is a list with one JSDocText in the port.
        if let Some(comment) = info.slots.iter().position(|slot| slot.name == "Comment") {
            for at in attrs_from..attrs_to {
                let record = dump.attrs.get(at * 4..at * 4 + 4).unwrap_or(&[]);
                let bit = 1u64 << ((at - attrs_from) & 63);
                if attr_used & bit == 0
                    && record.get(2) == Some(&2)
                    && dump.prop(record.get(1).copied().unwrap_or(-1)) == b"comment"
                {
                    let text = usize::try_from(record.get(3).copied().unwrap_or(-1))
                        .ok()
                        .and_then(|i| dump.strings.get(i))
                        .copied()
                        .unwrap_or(b"");
                    let text_node = builder.new_jsdoc_text(text);
                    let list = builder.new_node_list(&[text_node]);
                    if let Some(slot) = slots.get_mut(comment) {
                        *slot = list.0;
                    }
                    attr_used |= bit;
                    stats.made_nodes += 1;
                }
            }
        }
        let flags = node_flags(dump.node_field(node, 3) as u32);
        let id = builder.alloc_node(def, kind, flags, &slots);
        builder.set_loc(id, TextRange::new(pos as i32, end as i32));
        stats.made_nodes += 1;
        if let Some(slot) = made.get_mut(node) {
            *slot = id;
        }
        jsdoc.clear();
        for entry in children.iter_mut() {
            if !entry.1 && dump.prop(dump.node_field(entry.0, 5)) == b"jsDoc" {
                entry.1 = true;
                if let Some(doc) = made.get(entry.0).filter(|doc| !doc.is_nil()) {
                    jsdoc.push(*doc);
                }
            }
        }
        if !jsdoc.is_empty() {
            builder.attach_jsdoc(id, &jsdoc);
        }
        let lost_children = children.iter().filter(|entry| !entry.1).count() as u32;
        let lost_lists = lists.iter().filter(|entry| !entry.1).count() as u32;
        let lost_attrs = (attrs_from..attrs_to)
            .filter(|at| attr_used & (1u64 << ((at - attrs_from) & 63)) == 0)
            .count() as u32;
        if stats.first_unmapped.is_empty() && lost_children + lost_lists + lost_attrs > 0 {
            stats.first_unmapped = kind.name().as_bytes().to_vec();
            stats.first_unmapped.push(b'.');
            let lost = children
                .iter()
                .find(|entry| !entry.1)
                .map(|entry| dump.prop(dump.node_field(entry.0, 5)));
            let lost = lost.or_else(|| {
                lists
                    .iter()
                    .find(|entry| !entry.1)
                    .map(|entry| dump.prop(dump.lists.get(entry.0 * 5 + 1).copied().unwrap_or(-1)))
            });
            let lost = lost.or_else(|| {
                (attrs_from..attrs_to)
                    .find(|at| attr_used & (1u64 << ((at - attrs_from) & 63)) == 0)
                    .map(|at| dump.prop(dump.attrs.get(at * 4 + 1).copied().unwrap_or(-1)))
            });
            stats.first_unmapped.extend_from_slice(lost.unwrap_or(b"?"));
        }
        for entry in children.iter().filter(|entry| !entry.1) {
            stats.lost(kind, dump.prop(dump.node_field(entry.0, 5)));
        }
        for entry in lists.iter().filter(|entry| !entry.1) {
            stats.lost(
                kind,
                dump.prop(dump.lists.get(entry.0 * 5 + 1).copied().unwrap_or(-1)),
            );
        }
        for at in
            (attrs_from..attrs_to).filter(|at| attr_used & (1u64 << ((at - attrs_from) & 63)) == 0)
        {
            stats.lost(
                kind,
                dump.prop(dump.attrs.get(at * 4 + 1).copied().unwrap_or(-1)),
            );
        }
        stats.unmapped_children += lost_children;
        stats.unmapped_lists += lost_lists;
        stats.unmapped_attrs += lost_attrs;
    }
    stats.dump_nodes += count as u32;
    stats.files += 1;
    let root = made.first().copied().unwrap_or(NodeId::NIL);
    stats.build_ns += started.elapsed().as_nanos() as u64;
    let started = Instant::now();
    let file = builder.finish(root, data, ids);
    stats.finish_ns += started.elapsed().as_nanos() as u64;
    file
}

// Every file of a dump, not bound yet, in the order of the dump.
pub fn import_dump(
    bytes: &[u8],
    ids: &IdAllocator,
    stats: &mut ImportStats,
) -> Result<Vec<File>, ImportError> {
    let started = Instant::now();
    let root = Json::parse(bytes).map_err(ImportError::Json)?;
    stats.json_ns += started.elapsed().as_nanos() as u64;
    if root.get("v").map(Json::number) != Some(1.0) {
        return Err(ImportError::Version);
    }
    let kind_of = |name: &Json| match name.bytes() {
        b"EndOfFileToken" => Kind::EndOfFile,
        b"JSDocTag" => Kind::JSDocUnknownTag,
        other => Kind::from_name(other).unwrap_or(Kind::Unknown),
    };
    let kind_names = root
        .get("kinds")
        .ok_or(ImportError::Shape("kinds"))?
        .items();
    let kinds: Vec<Kind> = kind_names.iter().map(kind_of).collect();
    for (name, kind) in kind_names.iter().zip(&kinds) {
        let name = name.bytes();
        if *kind == Kind::Unknown
            && name != b"Unknown"
            && !stats.unknown_kind_names.iter().any(|known| known == name)
        {
            stats.unknown_kind_names.push(name.to_vec());
        }
    }
    let props: Vec<&[u8]> = root
        .get("props")
        .ok_or(ImportError::Shape("props"))?
        .items()
        .iter()
        .map(Json::bytes)
        .collect();
    let strings: Vec<&[u8]> = root
        .get("strings")
        .ok_or(ImportError::Shape("strings"))?
        .items()
        .iter()
        .map(Json::bytes)
        .collect();
    let mut files = Vec::new();
    for file in root
        .get("files")
        .ok_or(ImportError::Shape("files"))?
        .items()
    {
        let field = |name: &'static str| file.get(name).ok_or(ImportError::Shape(name));
        let dump = DumpFile {
            nodes: field("nodes")?.numbers(),
            lists: field("lists")?.numbers(),
            attrs: field("attrs")?.numbers(),
            kinds: &kinds,
            props: &props,
            strings: &strings,
            text: field("text")?.bytes(),
        };
        let data = SourceFileData {
            file_name: field("fileName")?.bytes().to_vec(),
            script_kind: field("scriptKind")?.number() as u8,
            language_variant: field("languageVariant")?.number() as u8,
            is_declaration_file: field("isDeclarationFile")?.is_true(),
            ..SourceFileData::default()
        };
        files.push(import_file(&dump, data, ids, stats).ok_or(ImportError::IdSpaceExhausted)?);
    }
    Ok(files)
}

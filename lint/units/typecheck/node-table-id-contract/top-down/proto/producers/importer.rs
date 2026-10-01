// The importer of the prototype: reads the flat dump that probes/flatten-converted.ts writes and fills a table
// through the raw calls of the builder. The dump names kinds and fields by their Go names.
use crate::ast::ast_generated::default_def;
use crate::ast::builder::RawValue;
use crate::ast::context::AstContext;
use crate::ast::flags_generated::{ModifierFlags, NodeFlags};
use crate::ast::kind_generated::Kind;
use crate::ast::table::{FileData, NodeTable};
use crate::core::new_text_range;
use crate::ids::NodeId;
use crate::producers::json::Json;

#[derive(Default)]
pub struct FileDump {
    pub file_name: Vec<u8>,
    pub script_kind: i32,
    pub language_variant: i32,
    pub is_declaration_file: bool,
    pub external_module_indicator: i32,
    pub nodes: Vec<i32>,
    pub lists: Vec<i32>,
    pub scalars: Vec<i32>,
    pub text: Vec<u8>,
}

#[derive(Default)]
pub struct Bundle {
    // The index of the first file in the corpus the bundle is a part of.
    pub start: u32,
    pub kinds: Vec<Kind>,
    pub fields: Vec<Vec<u8>>,
    pub strings: Vec<Vec<u8>>,
    pub files: Vec<FileDump>,
    pub unknown_kinds: u32,
}

fn strings(json: &mut Json<'_>) -> Vec<Vec<u8>> {
    let mut out = Vec::new();
    json.expect(b'[');
    let mut first = true;
    while json.more(&mut first, b']') {
        out.push(json.string());
    }
    out
}

fn file(json: &mut Json<'_>) -> FileDump {
    let mut dump = FileDump::default();
    json.expect(b'{');
    let mut first = true;
    while json.more(&mut first, b'}') {
        let key = json.string();
        json.expect(b':');
        match key.as_slice() {
            b"fileName" => dump.file_name = json.string(),
            b"scriptKind" => dump.script_kind = json.integer() as i32,
            b"languageVariant" => dump.language_variant = json.integer() as i32,
            b"isDeclarationFile" => dump.is_declaration_file = json.integer() != 0,
            b"externalModuleIndicator" => dump.external_module_indicator = json.integer() as i32,
            b"nodes" => json.integers(&mut dump.nodes),
            b"lists" => json.integers(&mut dump.lists),
            b"scalars" => json.integers(&mut dump.scalars),
            b"text" => dump.text = json.string(),
            _ => json.skip_value(),
        }
    }
    dump
}

// Reads a bundle. None when the bytes are not a dump.
pub fn read_bundle(bytes: &[u8]) -> Option<Bundle> {
    let mut json = Json::new(bytes);
    let mut bundle = Bundle::default();
    json.expect(b'{');
    let mut first = true;
    while json.more(&mut first, b'}') {
        let key = json.string();
        json.expect(b':');
        match key.as_slice() {
            b"kinds" => {
                for name in strings(&mut json) {
                    match Kind::from_name(&name) {
                        Some(kind) => bundle.kinds.push(kind),
                        None => {
                            bundle.unknown_kinds += 1;
                            bundle.kinds.push(Kind::Unknown);
                        }
                    }
                }
            }
            b"start" => bundle.start = json.integer() as u32,
            b"fields" => bundle.fields = strings(&mut json),
            b"strings" => bundle.strings = strings(&mut json),
            b"files" => {
                json.expect(b'[');
                let mut first_file = true;
                while json.more(&mut first_file, b']') {
                    bundle.files.push(file(&mut json));
                }
            }
            _ => json.skip_value(),
        }
    }
    if json.failed {
        return None;
    }
    Some(bundle)
}

const NODE_WORDS: usize = 7;
const LIST_WORDS: usize = 6;
const SCALAR_WORDS: usize = 4;

// Fills the arena of `a` with the nodes of one file and returns their ids in the order of the dump. The first is the root.
pub fn build_file(a: &AstContext<'_>, bundle: &Bundle, dump: &FileDump) -> Vec<NodeId> {
    let count = dump.nodes.len() / NODE_WORDS;
    let mut ids: Vec<NodeId> = Vec::with_capacity(count);
    for &[kind, pos, end, flags, _, _, _] in dump.nodes.as_chunks::<NODE_WORDS>().0 {
        let kind = bundle
            .kinds
            .get(kind as usize)
            .copied()
            .unwrap_or(Kind::Unknown);
        ids.push(a.raw_new_node(
            default_def(kind),
            kind,
            new_text_range(pos, end),
            NodeFlags::from_bits_retain(flags as u32),
        ));
    }
    let id = |index: i32| ids.get(index as usize).copied().unwrap_or(NodeId::NIL);
    let field = |index: i32| {
        bundle
            .fields
            .get(index as usize)
            .map_or(&[][..], Vec::as_slice)
    };
    let list_count = dump.lists.len() / LIST_WORDS;
    let mut elements: Vec<Vec<NodeId>> = vec![Vec::new(); list_count];
    let mut jsdoc: Vec<(NodeId, Vec<NodeId>)> = Vec::new();
    for (index, &[_, _, _, _, parent, field_index, list]) in
        dump.nodes.as_chunks::<NODE_WORDS>().0.iter().enumerate()
    {
        let me = id(index as i32);
        if list >= 0 {
            if let Some(slot) = elements.get_mut(list as usize) {
                slot.push(me);
            }
        } else if field_index == -2 {
            let host = id(parent);
            match jsdoc.last_mut() {
                Some(entry) if entry.0 == host => entry.1.push(me),
                _ => jsdoc.push((host, vec![me])),
            }
        } else if parent >= 0 && !a.raw_set(id(parent), field(field_index), RawValue::Node(me)) {
            a.unhandled("importer: no such node field", id(parent));
        }
    }
    for (index, &[owner, field_index, pos, end, kind, modifier_flags]) in
        dump.lists.as_chunks::<LIST_WORDS>().0.iter().enumerate()
    {
        let nodes = elements.get(index).map_or(&[][..], Vec::as_slice);
        let loc = new_text_range(pos, end);
        let made = if kind == 1 {
            a.raw_new_modifier_list(
                nodes,
                loc,
                ModifierFlags::from_bits_retain(modifier_flags as u32),
            )
            .as_node_list()
        } else {
            a.raw_new_list(nodes, loc)
        };
        if !a.raw_set(id(owner), field(field_index), RawValue::List(made)) {
            a.unhandled("importer: no such list field", id(owner));
        }
    }
    for &[node, field_index, kind, value] in dump.scalars.as_chunks::<SCALAR_WORDS>().0 {
        let raw = match kind {
            0 => RawValue::Bool(value != 0),
            1 => RawValue::Kind(
                bundle
                    .kinds
                    .get(value as usize)
                    .copied()
                    .unwrap_or(Kind::Unknown),
            ),
            2 => RawValue::Text(
                bundle
                    .strings
                    .get(value as usize)
                    .map_or(&[][..], Vec::as_slice),
            ),
            _ => RawValue::U32(value as u32),
        };
        if !a.raw_set(id(node), field(field_index), raw) {
            a.unhandled("importer: no such scalar field", id(node));
        }
    }
    for (host, nodes) in &jsdoc {
        a.raw_set_jsdoc(*host, nodes);
    }
    ids
}

// One file of a bundle as a local table, ready for the binder.
pub fn import_file(bundle: &Bundle, dump: &FileDump) -> (NodeTable, u32, usize) {
    let a = AstContext::for_building();
    let ids = build_file(&a, bundle, dump);
    let root = ids.first().copied().unwrap_or(NodeId::NIL);
    let file = FileData {
        file_name: dump.file_name.clone(),
        script_kind: dump.script_kind as u8,
        language_variant: dump.language_variant as u8,
        is_declaration_file: dump.is_declaration_file,
        external_module_indicator: ids
            .get(dump.external_module_indicator as usize)
            .copied()
            .unwrap_or(NodeId::NIL),
        ..FileData::default()
    };
    let table = a.finish(root, dump.text.clone(), file);
    (table, a.log.count(), a.arena.heap_bytes())
}

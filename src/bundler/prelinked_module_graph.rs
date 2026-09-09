//! Builds the pre-resolved ES module graph of a `--compile --bytecode` executable: every chunk's requested modules,
//! import and export entries as flat, index-keyed `u32` tables with names as ids into the shared module-info string
//! table, and imports already resolved to `(module index, binding)`. JSC's module loader borrows it in place
//! (`JSC::PrelinkedModuleGraph` in vendor WebKit `runtime/PrelinkedModuleGraph.h`, whose header comment is the layout
//! reference; bump `VERSION` on both sides together) instead of building per-record entry maps and running
//! ResolveExport at startup. Graph modules ship no per-module `module_info` body: the graph is their module record.

use bun_js_printer::analyze_transpiled_module::{
    FetchParameters, ModuleInfo, ModulePhase, RecordKind, StringID,
};

use crate::analyze_transpiled_module::ModuleInfoSlotTableBuilder;

pub const MAGIC: u32 = 0x474d_4c50; // "PLMG"
pub const VERSION: u32 = 3;
pub const NO_MODULE: u32 = u32::MAX;
/// Hash column value of an entry whose name is a sentinel (never looked up by name); sorts last.
const SENTINEL_HASH: u32 = u32::MAX;
/// Request indices are packed into 16 bits of each entry.
const MAX_REQUESTS_PER_MODULE: usize = u16::MAX as usize;

const STAR_NAMESPACE: u32 = StringID::STAR_NAMESPACE.0;

mod module_flags {
    pub(super) const HAS_IMPORT_META: u32 = 1 << 0;
    pub(super) const IS_TYPESCRIPT: u32 = 1 << 1;
    pub(super) const HAS_TLA: u32 = 1 << 2;
    pub(super) const HAS_STAR_EXPORTS: u32 = 1 << 3;
    pub(super) const ALL_REQUESTS_IN_GRAPH: u32 = 1 << 4;
}

/// `PrelinkedModuleGraph::Request::phaseDeferBit`.
const PHASE_DEFER_BIT: u32 = 1 << 3;

const HEADER_WORDS: usize = 16;
const MODULE_WORDS: usize = 11;
const REQUEST_WORDS: usize = 4;
const IMPORT_WORDS: usize = 6;
const EXPORT_WORDS: usize = 6;

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
enum ImportKind {
    Single = 0,
    SingleTypeScript = 1,
    Namespace = 2,
    NamespaceDefer = 3,
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
enum ExportKind {
    Local = 0,
    Indirect = 1,
    Namespace = 2,
}

/// `PrelinkedModuleGraph::ResolutionKind`. `Ambiguous` is never claimed at build time (left `Unresolved`).
#[derive(Clone, Copy, PartialEq, Eq)]
enum Resolution {
    Unresolved,
    Binding { module: u32, local: u32 },
    Namespace { module: u32 },
    NotFound,
    Error,
}
impl Resolution {
    fn encode(self) -> (u32, u32, u32) {
        match self {
            Resolution::Unresolved => (0, NO_MODULE, 0),
            Resolution::Binding { module, local } => (1, module, local),
            Resolution::Namespace { module } => (2, module, STAR_NAMESPACE),
            Resolution::NotFound => (3, NO_MODULE, 0),
            Resolution::Error => (5, NO_MODULE, 0),
        }
    }
}

struct Request {
    specifier: u32,
    module: u32,
    attributes: u32,
    host_defined: u32,
}
struct Import {
    local: u32,
    import_name: u32,
    request: u32,
    kind: ImportKind,
    resolution: Resolution,
}
struct Export {
    name: u32,
    kind: ExportKind,
    /// Local: local name; Indirect: import name (`STAR_NAMESPACE` for `export * as ns` seen through an import).
    local_or_import: u32,
    request: u32,
    resolution: Resolution,
}
struct Module {
    key: u32,
    flags: u32,
    requests: Vec<Request>,
    imports: Vec<Import>,
    exports: Vec<Export>,
    /// Request indices, source order.
    star_exports: Vec<u32>,
    export_by_name: bun_collections::HashMap<u32, u32>,
}

/// One ES module chunk of the executable.
pub struct ModuleInput<'a> {
    /// The specifier other chunks' `module_info` requests it by (public path + final path), i.e. its module key at runtime.
    pub path: &'a [u8],
    pub info: &'a ModuleInfo,
    /// Local string id → id in the shared module-info string table (`ModuleInfoSlotTableBuilder::intern_all`).
    pub table_ids: &'a [u32],
}

/// The module count in a serialized graph's header; `None` if `bytes` is not a graph of this `VERSION`.
pub fn module_count(bytes: &[u8]) -> Option<u32> {
    let word = |i: usize| {
        Some(u32::from_le_bytes(
            bytes.get(i * 4..i * 4 + 4)?.try_into().ok()?,
        ))
    };
    (word(0)? == MAGIC && word(1)? == VERSION).then_some(word(3)?)
}

/// Serializes the graph for `modules` (graph module `i` is `modules[i]`). `string_table` gives a string's runtime slot
/// (`EncoderStringTable::slotFor`); name hashes are `WTF::StringImpl::hash()`. Must run before `strings` is serialized
/// (module keys are interned into it). `None` if the graph does not fit the format; the caller then keeps per-module
/// `module_info` bodies.
pub(crate) fn build(
    modules: &[ModuleInput<'_>],
    strings: &mut ModuleInfoSlotTableBuilder,
    string_table: &crate::bundle_v2::dispatch::EncoderStringTableHandle,
) -> Option<Vec<u8>> {
    let slot_for = |s: &[u8]| string_table.slot(s);
    let mut path_to_module: bun_collections::HashMap<Vec<u8>, u32> = Default::default();
    for (index, module) in modules.iter().enumerate() {
        path_to_module.insert(module.path.to_vec(), index as u32);
    }

    // hash(shared sid), computed from whichever module's local copy of the string we meet first.
    let mut hashes: Vec<Option<u32>> = Vec::new();

    // ResolveExport's export-star rule needs to recognise the name "default" by sid.
    let default_sid = strings.intern(b"default", slot_for);
    note_hash(&mut hashes, default_sid, b"default");

    let mut graph: Vec<Module> = Vec::with_capacity(modules.len());
    for input in modules {
        let key = strings.intern(input.path, slot_for);
        note_hash(&mut hashes, key, input.path);
        let module = parse_module(input, key, &path_to_module, &mut hashes);
        if module.requests.len() > MAX_REQUESTS_PER_MODULE {
            return None;
        }
        graph.push(module);
    }

    // Resolve every import and re-export against the other modules' export tables.
    let mut resolver = Resolver {
        graph: &graph,
        default_sid,
        memo: Default::default(),
        in_progress: Default::default(),
    };
    let mut resolutions: Vec<(Vec<Resolution>, Vec<Resolution>)> = Vec::with_capacity(graph.len());
    for (index, module) in graph.iter().enumerate() {
        let imports = module
            .imports
            .iter()
            .map(|import| {
                let target = module.requests[import.request as usize].module;
                if target == NO_MODULE {
                    return Resolution::Unresolved;
                }
                match import.kind {
                    ImportKind::Namespace | ImportKind::NamespaceDefer => {
                        Resolution::Namespace { module: target }
                    }
                    ImportKind::Single | ImportKind::SingleTypeScript => {
                        resolver.resolve(target, import.import_name)
                    }
                }
            })
            .collect();
        let exports = module
            .exports
            .iter()
            .map(|export| match export.kind {
                ExportKind::Local => Resolution::Binding {
                    module: index as u32,
                    local: export.local_or_import,
                },
                ExportKind::Indirect | ExportKind::Namespace => {
                    let target = module.requests[export.request as usize].module;
                    if target == NO_MODULE {
                        Resolution::Unresolved
                    } else if export.kind == ExportKind::Namespace
                        || export.local_or_import == STAR_NAMESPACE
                    {
                        Resolution::Namespace { module: target }
                    } else {
                        resolver.resolve(target, export.local_or_import)
                    }
                }
            })
            .collect();
        resolutions.push((imports, exports));
    }
    debug_assert!(resolver.in_progress.is_empty());
    for (module, (imports, exports)) in graph.iter_mut().zip(resolutions) {
        for (import, resolution) in module.imports.iter_mut().zip(imports) {
            import.resolution = resolution;
        }
        for (export, resolution) in module.exports.iter_mut().zip(exports) {
            export.resolution = resolution;
        }
    }

    // By-name lookups at runtime binary-search these by the name's hash (stored in the entry).
    let hash = |sid: u32| name_hash(&hashes, sid);
    for module in graph.iter_mut() {
        module
            .imports
            .sort_by_key(|import| (hash(import.local), import.local));
        module
            .exports
            .sort_by_key(|export| (hash(export.name), export.name));
    }

    Some(serialize(&graph, strings.count(), &hashes))
}

fn name_hash(hashes: &[Option<u32>], sid: u32) -> u32 {
    if sid >= STAR_NAMESPACE {
        SENTINEL_HASH
    } else {
        hashes[sid as usize].expect("every named string was hashed when parsed")
    }
}

fn note_hash(hashes: &mut Vec<Option<u32>>, sid: u32, bytes: &[u8]) {
    if sid >= STAR_NAMESPACE {
        return;
    }
    if hashes.len() <= sid as usize {
        hashes.resize(sid as usize + 1, None);
    }
    if hashes[sid as usize].is_none() {
        hashes[sid as usize] = Some(crate::bundle_v2::dispatch::wtf_string_hash(bytes));
    }
}

fn parse_module(
    input: &ModuleInput<'_>,
    key: u32,
    path_to_module: &bun_collections::HashMap<Vec<u8>, u32>,
    hashes: &mut Vec<Option<u32>>,
) -> Module {
    let info = input.info.as_deserialized();
    let (strings_buf, strings_lens) = input.info.strings();
    let mut string_offsets: Vec<usize> = Vec::with_capacity(strings_lens.len());
    let mut offset = 0usize;
    for &len in strings_lens {
        string_offsets.push(offset);
        offset += len as usize;
    }
    let local_string = |id: StringID| -> &[u8] {
        let at = string_offsets[id.0 as usize];
        &strings_buf[at..at + strings_lens[id.0 as usize] as usize]
    };
    // Local string id → shared sid; the two sentinels are the same values on both sides.
    let mut shared = |id: StringID| -> u32 {
        if id.0 >= STAR_NAMESPACE {
            return id.0;
        }
        let sid = input.table_ids[id.0 as usize];
        note_hash(hashes, sid, local_string(id));
        sid
    };

    let mut flags = 0u32;
    if info.flags.contains_import_meta {
        flags |= module_flags::HAS_IMPORT_META;
    }
    if info.flags.is_typescript {
        flags |= module_flags::IS_TYPESCRIPT;
    }
    if info.flags.has_tla {
        flags |= module_flags::HAS_TLA;
    }

    // Requested modules, in the record's order. An entry references its request by (specifier, type), as
    // hostResolveImportedModule would look it up.
    let mut requests: Vec<Request> = Vec::with_capacity(info.requested_modules_keys.len());
    let mut request_index: bun_collections::HashMap<(u32, u8), u32> = Default::default();
    let mut all_in_graph = true;
    for ((&specifier, &value), &phase) in info
        .requested_modules_keys
        .iter()
        .zip(info.requested_modules_values)
        .zip(info.requested_modules_phases)
    {
        // Only a plain JavaScript request loads the target chunk's ES module record; `with { type: ... }` of the same
        // path is some other (synthetic / host-defined) module the runtime resolves itself.
        let is_javascript = matches!(value, FetchParameters::None | FetchParameters::Javascript);
        let module = if is_javascript {
            path_to_module
                .get(local_string(specifier))
                .copied()
                .unwrap_or(NO_MODULE)
        } else {
            NO_MODULE
        };
        all_in_graph &= module != NO_MODULE;
        let (fetch_kind, host_defined) = match value {
            FetchParameters::None => (0u32, 0u32),
            FetchParameters::Javascript => (1, 0),
            FetchParameters::Webassembly => (2, 0),
            FetchParameters::Json => (3, 0),
            host => (4, shared(StringID(host.0))),
        };
        let index = requests.len() as u32;
        request_index
            .entry((specifier.0, value.to_script_fetch_parameters_type()))
            .or_insert_with(|| index);
        requests.push(Request {
            specifier: shared(specifier),
            module,
            attributes: fetch_kind
                | if phase == ModulePhase::Defer {
                    PHASE_DEFER_BIT
                } else {
                    0
                },
            host_defined,
        });
    }
    if all_in_graph {
        flags |= module_flags::ALL_REQUESTS_IN_GRAPH;
    }
    let request_for = |module_name: StringID, fetch: FetchParameters| -> u32 {
        *request_index
            .get(&(module_name.0, fetch.to_script_fetch_parameters_type()))
            .expect("module_info lists every module its entries reference")
    };

    let mut imports: Vec<Import> = Vec::new();
    let mut exports: Vec<Export> = Vec::new();
    let mut star_exports: Vec<u32> = Vec::new();
    let mut at = 0usize;
    for &kind in info.record_kinds {
        let data = &info.buffer[at..at + kind.len()];
        at += kind.len();
        match kind {
            RecordKind::ImportInfoSingle | RecordKind::ImportInfoSingleTypeScript => {
                let request = request_for(data[0], FetchParameters(data[3].0));
                imports.push(Import {
                    local: shared(data[2]),
                    import_name: shared(data[1]),
                    request,
                    kind: if kind == RecordKind::ImportInfoSingle {
                        ImportKind::Single
                    } else {
                        ImportKind::SingleTypeScript
                    },
                    resolution: Resolution::Unresolved,
                });
            }
            RecordKind::ImportInfoNamespace | RecordKind::ImportInfoNamespaceDefer => {
                let request = request_for(data[0], FetchParameters(data[3].0));
                imports.push(Import {
                    local: shared(data[2]),
                    import_name: STAR_NAMESPACE,
                    request,
                    kind: if kind == RecordKind::ImportInfoNamespace {
                        ImportKind::Namespace
                    } else {
                        ImportKind::NamespaceDefer
                    },
                    resolution: Resolution::Unresolved,
                });
            }
            RecordKind::ExportInfoIndirect => {
                let request = request_for(data[2], FetchParameters(data[3].0));
                exports.push(Export {
                    name: shared(data[0]),
                    kind: ExportKind::Indirect,
                    local_or_import: shared(data[1]),
                    request,
                    resolution: Resolution::Unresolved,
                });
            }
            RecordKind::ExportInfoLocal => exports.push(Export {
                name: shared(data[0]),
                kind: ExportKind::Local,
                local_or_import: shared(data[1]),
                request: 0,
                resolution: Resolution::Unresolved,
            }),
            RecordKind::ExportInfoNamespace => {
                let request = request_for(data[1], FetchParameters(data[2].0));
                exports.push(Export {
                    name: shared(data[0]),
                    kind: ExportKind::Namespace,
                    local_or_import: STAR_NAMESPACE,
                    request,
                    resolution: Resolution::Unresolved,
                });
            }
            RecordKind::ExportInfoStar => {
                star_exports.push(request_for(data[0], FetchParameters(data[1].0)));
            }
        }
    }
    if !star_exports.is_empty() {
        flags |= module_flags::HAS_STAR_EXPORTS;
    }
    // First declaration wins, as in AbstractModuleRecord::addExportEntry.
    let mut export_by_name: bun_collections::HashMap<u32, u32> = Default::default();
    for (index, export) in exports.iter().enumerate() {
        export_by_name
            .entry(export.name)
            .or_insert_with(|| index as u32);
    }

    Module {
        key,
        flags,
        requests,
        imports,
        exports,
        star_exports,
        export_by_name,
    }
}

/// ResolveExport over the not-yet-resolved graph. Anything the specification would decide by looking outside the
/// graph or by comparing star-export candidates it cannot see is left `Unresolved` for the runtime; so is a query
/// that runs into itself (a re-export cycle), without poisoning the memo for queries that merely passed through it.
struct Resolver<'a> {
    graph: &'a [Module],
    default_sid: u32,
    memo: bun_collections::HashMap<(u32, u32), Resolution>,
    in_progress: bun_collections::HashMap<(u32, u32), ()>,
}
/// (resolution, tainted): a tainted result depended on an in-progress query and is not memoized.
type ResolveStep = (Resolution, bool);
impl Resolver<'_> {
    fn resolve(&mut self, module: u32, name: u32) -> Resolution {
        self.resolve_step(module, name).0
    }

    fn resolve_step(&mut self, module: u32, name: u32) -> ResolveStep {
        if let Some(&known) = self.memo.get(&(module, name)) {
            return (known, false);
        }
        if self.in_progress.contains_key(&(module, name)) {
            return (Resolution::Unresolved, true);
        }
        self.in_progress.insert((module, name), ());
        let (result, tainted) = self.resolve_uncached(module, name);
        self.in_progress.remove(&(module, name));
        if !tainted {
            self.memo.insert((module, name), result);
        }
        (result, tainted)
    }

    fn resolve_uncached(&mut self, module: u32, name: u32) -> ResolveStep {
        let graph = self.graph;
        let m = &graph[module as usize];
        if let Some(&index) = m.export_by_name.get(&name) {
            let export = &m.exports[index as usize];
            return match export.kind {
                ExportKind::Local => (
                    Resolution::Binding {
                        module,
                        local: export.local_or_import,
                    },
                    false,
                ),
                ExportKind::Indirect | ExportKind::Namespace => {
                    let target = m.requests[export.request as usize].module;
                    if target == NO_MODULE {
                        (Resolution::Unresolved, false)
                    } else if export.kind == ExportKind::Namespace
                        || export.local_or_import == STAR_NAMESPACE
                    {
                        (Resolution::Namespace { module: target }, false)
                    } else {
                        match self.resolve_step(target, export.local_or_import) {
                            // JSC (resolveExportImpl's IndirectFallback) falls back to this module's star exports here.
                            (Resolution::NotFound, tainted) if !m.star_exports.is_empty() => {
                                (Resolution::Unresolved, tainted)
                            }
                            other => other,
                        }
                    }
                }
            };
        }
        if name == self.default_sid {
            // A default export cannot be provided by `export *`.
            return (Resolution::Error, false);
        }
        let mut found: Option<Resolution> = None;
        let mut tainted = false;
        for &request in &m.star_exports {
            let target = m.requests[request as usize].module;
            if target == NO_MODULE {
                return (Resolution::Unresolved, tainted);
            }
            let (resolution, step_tainted) = self.resolve_step(target, name);
            tainted |= step_tainted;
            match resolution {
                Resolution::NotFound => {}
                Resolution::Binding { .. } | Resolution::Namespace { .. } => match found {
                    None => found = Some(resolution),
                    Some(existing) if existing == resolution => {}
                    Some(_) => return (Resolution::Unresolved, tainted),
                },
                Resolution::Unresolved | Resolution::Error => {
                    return (Resolution::Unresolved, tainted);
                }
            }
        }
        (found.unwrap_or(Resolution::NotFound), tainted)
    }
}

/// `PrelinkedModuleGraph::importIndexSlotCount`: the power of two >= 2 * imports, 0 without imports.
fn import_index_slot_count(import_count: usize) -> usize {
    if import_count == 0 {
        0
    } else {
        (2 * import_count).next_power_of_two()
    }
}

fn serialize(graph: &[Module], string_count: u32, hashes: &[Option<u32>]) -> Vec<u8> {
    let hash = |sid: u32| name_hash(hashes, sid);
    let request_count: usize = graph.iter().map(|m| m.requests.len()).sum();
    let import_count: usize = graph.iter().map(|m| m.imports.len()).sum();
    let export_count: usize = graph.iter().map(|m| m.exports.len()).sum();
    let star_count: usize = graph.iter().map(|m| m.star_exports.len()).sum();

    let modules_offset = HEADER_WORDS * 4;
    let requests_offset = modules_offset + graph.len() * MODULE_WORDS * 4;
    let imports_offset = requests_offset + request_count * REQUEST_WORDS * 4;
    let exports_offset = imports_offset + import_count * IMPORT_WORDS * 4;
    let stars_offset = exports_offset + export_count * EXPORT_WORDS * 4;
    let import_index_offset = stars_offset + star_count * 4;
    let import_index_slots: usize = graph
        .iter()
        .map(|m| import_index_slot_count(m.imports.len()))
        .sum();
    let import_index_bytes = (import_index_slots * 2 + 3) & !3; // u16 slots, padded to 4
    let total = import_index_offset + import_index_bytes;

    let mut out: Vec<u8> = Vec::with_capacity(total);
    let mut put = |v: u32| out.extend_from_slice(&v.to_le_bytes());
    let to_u32 = |v: usize| u32::try_from(v).expect("prelinked module graph exceeds u32");
    // kind | resolution << 8 | request << 16 (`PrelinkedModuleGraph::KindBits`).
    let bits = |kind: u32, resolution: u32, request: u32| -> u32 {
        debug_assert!(request <= u16::MAX as u32);
        kind | resolution << 8 | request << 16
    };

    for v in [
        MAGIC,
        VERSION,
        string_count,
        to_u32(graph.len()),
        to_u32(request_count),
        to_u32(import_count),
        to_u32(export_count),
        to_u32(star_count),
        to_u32(modules_offset),
        to_u32(requests_offset),
        to_u32(imports_offset),
        to_u32(exports_offset),
        to_u32(stars_offset),
        to_u32(import_index_offset),
        to_u32(import_index_bytes),
        0,
    ] {
        put(v);
    }

    let (mut first_request, mut first_import, mut first_export, mut first_star, mut index_offset) =
        (0usize, 0usize, 0usize, 0usize, 0usize);
    for m in graph {
        for v in [
            m.key,
            m.flags,
            to_u32(first_request),
            to_u32(m.requests.len()),
            to_u32(first_import),
            to_u32(m.imports.len()),
            to_u32(first_export),
            to_u32(m.exports.len()),
            to_u32(first_star),
            to_u32(m.star_exports.len()),
            to_u32(index_offset),
        ] {
            put(v);
        }
        first_request += m.requests.len();
        first_import += m.imports.len();
        first_export += m.exports.len();
        first_star += m.star_exports.len();
        index_offset += import_index_slot_count(m.imports.len()) * 2;
    }
    for m in graph {
        for r in &m.requests {
            for v in [r.specifier, r.module, r.attributes, r.host_defined] {
                put(v);
            }
        }
    }
    for m in graph {
        for i in &m.imports {
            let (resolution, module, local) = i.resolution.encode();
            for v in [
                i.local,
                i.import_name,
                bits(i.kind as u32, resolution, i.request),
                hash(i.local),
                module,
                local,
            ] {
                put(v);
            }
        }
    }
    for m in graph {
        for e in &m.exports {
            let (resolution, module, local) = e.resolution.encode();
            for v in [
                e.name,
                e.local_or_import,
                bits(e.kind as u32, resolution, e.request),
                hash(e.name),
                module,
                local,
            ] {
                put(v);
            }
        }
    }
    for m in graph {
        for &s in &m.star_exports {
            put(s);
        }
    }
    // Per-module open-addressed index over its imports (`PrelinkedModuleGraph::findImport`): slot = hash & mask,
    // linear probing, value = position within the module's imports + 1, 0 = empty; load <= 1/2.
    for m in graph {
        let slot_count = import_index_slot_count(m.imports.len());
        let mut slots = vec![0u16; slot_count];
        for (position, import) in m.imports.iter().enumerate() {
            let h = hash(import.local);
            if h == SENTINEL_HASH {
                continue;
            }
            let mut i = h as usize & (slot_count - 1);
            while slots[i] != 0 {
                i = (i + 1) & (slot_count - 1);
            }
            slots[i] = u16::try_from(position + 1).expect("imports per module fit the u16 index");
        }
        for slot in slots {
            out.extend_from_slice(&slot.to_le_bytes());
        }
    }
    out.resize(total, 0);
    debug_assert_eq!(out.len(), total);
    out
}

// The table of one source file: the syntax that a producer made, frozen when the producer finishes, and what its binder leaves once.
use crate::ast::ast::{
    CheckJsDirective, CommentDirective, FileReference, PatternAmbientModule, Pragma,
};
use crate::ast::ast_generated::Def;
use crate::ast::diagnostic::DiagnosticStore;
use crate::ast::flow::{FlowList, FlowNode};
use crate::ast::ids::{
    DiagnosticId, NodeId, NodeListId, OPEN_BIT, PAGE_SIZE, SymbolId, SymbolTableId,
};
use crate::ast::kind_generated::Kind;
use crate::ast::modifierflags::ModifierFlags;
use crate::ast::nodeflags::NodeFlags;
use crate::ast::symbol::index_find;
use crate::ast::symbolflags::SymbolFlags;
use crate::core::{
    LanguageVariant, ScriptKind, TextPos, TextRange, Tristate, compute_ecma_line_starts,
};
use crate::internal::Fault;
use crate::tspath::Path;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};

#[derive(Clone, Copy, Default, Debug)]
pub struct NodeRecord {
    pub(crate) loc: TextRange,
    pub(crate) parent: NodeId,
    // The first slot of the node.
    pub(crate) data: u32,
    // The first field of the binder that the node has.
    pub(crate) late: u32,
    pub(crate) kind: Kind,
    pub(crate) def: Def,
}

const _: () = assert!(size_of::<NodeRecord>() == 24);

#[derive(Clone, Copy, Default, Debug)]
pub struct ListRecord {
    pub(crate) loc: TextRange,
    pub(crate) start: u32,
    pub(crate) len: u32,
    // ModifierList.ModifierFlags; none in a NodeList.
    pub(crate) modifier_flags: ModifierFlags,
}

#[derive(Clone, Copy, Default, Debug)]
pub struct TextSpan {
    pub(crate) start: u32,
    pub(crate) len: u32,
}

// ast.Symbol of a bound file. The declarations are a run of `Bound::declarations`.
#[derive(Default, Debug)]
pub struct SymbolRecord {
    pub(crate) flags: SymbolFlags,
    // A span of the bytes of the file, or with the open bit in its start a span of the bytes of the bind result.
    pub(crate) name: TextSpan,
    pub(crate) declarations_start: u32,
    pub(crate) declarations_len: u32,
    pub(crate) value_declaration: NodeId,
    pub(crate) members: SymbolTableId,
    pub(crate) exports: SymbolTableId,
    pub(crate) parent: SymbolId,
    pub(crate) export_symbol: SymbolId,
    // ast.GetSymbolId: 0 until it is asked for, as the atomic id of upstream's Symbol.
    pub(crate) id: AtomicU64,
}

// ast.SymbolTable of a bound file: entries in insertion order and, above eight entries, a hash index.
#[derive(Clone, Copy, Default, Debug)]
pub struct TableRecord {
    pub(crate) entries_start: u32,
    pub(crate) len: u32,
    pub(crate) index_start: u32,
    // A power of two, or 0 for a table that is searched in order.
    pub(crate) index_len: u32,
}

#[derive(Clone, Copy, Default, Debug)]
pub struct TableEntry {
    pub(crate) name: TextSpan,
    pub(crate) symbol: SymbolId,
}

// What upstream's SourceFile keeps beside its two children, as far as the parser sets it. `finish` maps the node ids.
#[derive(Default, Debug)]
pub struct SourceFileData {
    pub file_name: Vec<u8>,
    pub path: Path,
    // SourceFile.diagnostics: the parse diagnostics, ids of `diagnostic_store`.
    pub diagnostics: Vec<DiagnosticId>,
    // The store of the parser of the file: its parse diagnostics and their related information.
    pub diagnostic_store: DiagnosticStore,
    pub language_variant: LanguageVariant,
    pub script_kind: ScriptKind,
    pub is_declaration_file: bool,
    pub uses_uri_style_node_core_modules: Tristate,
    pub identifier_count: u32,
    pub imports: Vec<NodeId>,
    pub module_augmentations: Vec<NodeId>,
    pub ambient_module_names: Vec<Vec<u8>>,
    pub comment_directives: Vec<CommentDirective>,
    pub reparsed_clones: Vec<NodeId>,
    pub pragmas: Vec<Pragma>,
    pub referenced_files: Vec<FileReference>,
    pub type_reference_directives: Vec<FileReference>,
    pub lib_reference_directives: Vec<FileReference>,
    pub check_js_directive: Option<CheckJsDirective>,
    pub node_count: u32,
    pub text_count: u32,
    pub common_js_module_indicator: NodeId,
    // The source file itself when the module was forced to be an external module.
    pub external_module_indicator: NodeId,
    // The SourceFile node and the length of the source text: `finish` sets both, and the two counts above.
    pub root: NodeId,
    pub text_len: u32,
}

// What the binder adds to a file. Its ids are `base + index` in every id space of the binder.
#[derive(Default)]
pub struct Bound {
    pub(crate) base: u32,
    pub(crate) span: u32,
    // The flags of every node of the file after binding. Empty when the ids of the binder could not be given.
    pub(crate) flags: Vec<NodeFlags>,
    // The binder fields of every node of the file: NodeRecord::late is the first of a node.
    pub(crate) late: Vec<u32>,
    // The nodes that the binder or a program made: the data of switch clause and reduce label flow nodes.
    pub(crate) records: Vec<NodeRecord>,
    pub(crate) record_flags: Vec<NodeFlags>,
    pub(crate) slots: Vec<u32>,
    // The texts of those nodes: spans of `text_bytes`.
    pub(crate) texts: Vec<TextSpan>,
    // The texts of those nodes and the names that are no slice of the bytes of the file.
    pub(crate) text_bytes: Vec<u8>,
    pub(crate) symbols: Vec<SymbolRecord>,
    pub(crate) declarations: Vec<NodeId>,
    pub(crate) tables: Vec<TableRecord>,
    pub(crate) table_entries: Vec<TableEntry>,
    pub(crate) table_index: Vec<u32>,
    pub(crate) flow_nodes: Vec<FlowNode>,
    pub(crate) flow_lists: Vec<FlowList>,
    // SourceFile.bindDiagnostics: ids of `bind_diagnostic_store`.
    pub(crate) bind_diagnostics: Vec<DiagnosticId>,
    // The store of the binder of the file: its diagnostics and their related information.
    pub(crate) bind_diagnostic_store: DiagnosticStore,
    // SourceFile.SymbolCount
    pub(crate) file_symbol_count: isize,
    // SourceFile.GlobalExports
    pub(crate) global_exports: SymbolTableId,
    // SourceFile.PatternAmbientModules
    pub(crate) pattern_ambient_modules: Vec<PatternAmbientModule>,
    // SourceFile.CommonJSModuleIndicator when the binder set it.
    pub(crate) common_js_module_indicator: NodeId,
    // What the binder recorded where upstream panics: the first ones, and the number of all.
    pub(crate) faults: Vec<Fault>,
    pub(crate) fault_count: u32,
}

#[derive(Default)]
pub struct File {
    // The ids of the nodes and of the lists of the file are base + 1 .. base + span.
    pub(crate) base: u32,
    pub(crate) span: u32,
    pub(crate) records: Vec<NodeRecord>,
    // The flags that the producer gave. The flags after binding are in the bind result.
    pub(crate) flags: Vec<NodeFlags>,
    pub(crate) slots: Vec<u32>,
    pub(crate) lists: Vec<ListRecord>,
    pub(crate) list_items: Vec<NodeId>,
    pub(crate) texts: Vec<TextSpan>,
    // The source text, then the texts that are not in it.
    pub(crate) text_bytes: Vec<u8>,
    // Hosts in ascending order with the list of their JSDoc nodes.
    pub(crate) jsdoc: Vec<(NodeId, NodeListId)>,
    // The number of binder fields of all nodes together.
    pub(crate) late_len: u32,
    // Set once, when the binding of the file ends.
    pub(crate) bound: OnceLock<Bound>,
    // SourceFile.ecmaLineMap, computed when it is first asked for.
    pub(crate) ecma_line_map: OnceLock<Vec<TextPos>>,
    // What the producer recorded where upstream panics: the first ones, and the number of all.
    pub(crate) faults: Vec<Fault>,
    pub(crate) fault_count: u32,
    pub source_file: SourceFileData,
}

// A file and what its binder left are shared between the programs and the checkers of a process.
const _: () = {
    const fn assert_sync<T: Sync + Send>() {}
    assert_sync::<File>();
};

// Hands out the id ranges of the files of a process and the numbers of ast.GetSymbolId.
pub struct IdAllocator {
    next: AtomicU32,
    symbol_ids: AtomicU64,
}

// The allocator that the files of a process share, so a file keeps its ids in every program that uses it.
pub static PROCESS_IDS: IdAllocator = IdAllocator::new();

impl Default for IdAllocator {
    fn default() -> Self {
        Self::new()
    }
}

impl IdAllocator {
    // Page 0 is never given out: id 0 is nil.
    pub const fn new() -> Self {
        Self {
            next: AtomicU32::new(PAGE_SIZE),
            symbol_ids: AtomicU64::new(0),
        }
    }

    // A base for `span` ids, or None when the id space below the open bit is used up.
    pub fn alloc(&self, span: u32) -> Option<u32> {
        let mut current = self.next.load(Ordering::Relaxed);
        loop {
            let end = current.checked_add(span).filter(|end| *end <= OPEN_BIT)?;
            match self.next.compare_exchange_weak(
                current,
                end,
                Ordering::Relaxed,
                Ordering::Relaxed,
            ) {
                Ok(_) => return Some(current),
                Err(seen) => current = seen,
            }
        }
    }

    // nextSymbolId.Add(1) of ast/utilities.go: one counter for the binders and the checkers of a process.
    pub fn next_symbol_id(&self) -> u64 {
        self.symbol_ids.fetch_add(1, Ordering::Relaxed) + 1
    }

    // The first id that no file has.
    pub fn used(&self) -> u32 {
        self.next.load(Ordering::Relaxed)
    }
}

pub(crate) fn round_up_to_page(count: u32) -> Option<u32> {
    count
        .checked_add(PAGE_SIZE - 1)
        .map(|n| n & !(PAGE_SIZE - 1))
}

// Where `text` lies in `pool`, when it is a slice of it. Only addresses are compared.
pub(crate) fn span_in(pool: &[u8], text: &[u8]) -> Option<TextSpan> {
    let range = pool.as_ptr_range();
    let at = text.as_ptr().addr();
    if text.is_empty() || at < range.start.addr() || at + text.len() > range.end.addr() {
        return None;
    }
    Some(TextSpan {
        start: u32::try_from(at - range.start.addr()).ok()?,
        len: u32::try_from(text.len()).ok()?,
    })
}

impl Bound {
    pub fn base(&self) -> u32 {
        self.base
    }

    pub fn span(&self) -> u32 {
        self.span
    }

    // The symbols that the binder made, the nil record not counted.
    pub fn symbol_count(&self) -> u32 {
        self.symbols.len().saturating_sub(1) as u32
    }

    pub fn table_count(&self) -> u32 {
        self.tables.len().saturating_sub(1) as u32
    }

    pub fn flow_node_count(&self) -> u32 {
        self.flow_nodes.len().saturating_sub(1) as u32
    }

    pub fn node_count(&self) -> u32 {
        self.records.len().saturating_sub(1) as u32
    }

    // The faults of the binding: the first ones in the order they were recorded.
    pub fn faults(&self) -> &[Fault] {
        &self.faults
    }

    // The number of faults of the binding, the ones that were not kept included.
    pub fn fault_count(&self) -> u32 {
        self.fault_count
    }

    // The bytes that the bind result keeps on the heap.
    pub fn heap_bytes(&self) -> usize {
        self.flags.capacity() * size_of::<NodeFlags>()
            + self.late.capacity() * size_of::<u32>()
            + self.records.capacity() * size_of::<NodeRecord>()
            + self.record_flags.capacity() * size_of::<NodeFlags>()
            + self.slots.capacity() * size_of::<u32>()
            + self.texts.capacity() * size_of::<TextSpan>()
            + self.text_bytes.capacity()
            + self.symbols.capacity() * size_of::<SymbolRecord>()
            + self.declarations.capacity() * size_of::<NodeId>()
            + self.tables.capacity() * size_of::<TableRecord>()
            + self.table_entries.capacity() * size_of::<TableEntry>()
            + self.table_index.capacity() * size_of::<u32>()
            + self.flow_nodes.capacity() * size_of::<FlowNode>()
            + self.flow_lists.capacity() * size_of::<FlowList>()
    }

    #[inline]
    pub(crate) fn record(&self, local: usize) -> Option<&NodeRecord> {
        if local == 0 {
            return None;
        }
        self.records.get(local)
    }

    #[inline]
    pub(crate) fn node_flags(&self, local: usize) -> NodeFlags {
        self.record_flags
            .get(local)
            .copied()
            .unwrap_or(NodeFlags::NONE)
    }

    #[inline]
    fn own_bytes(&self, span: TextSpan) -> &[u8] {
        let start = (span.start & !OPEN_BIT) as usize;
        self.text_bytes
            .get(start..start + span.len as usize)
            .unwrap_or(&[])
    }

    // A text of a node that the binder or a program made.
    #[inline]
    pub(crate) fn text(&self, handle: u32) -> &[u8] {
        match self.texts.get(handle as usize) {
            Some(span) => self.own_bytes(*span),
            None => &[],
        }
    }

    pub(crate) fn symbol_declarations(&self, symbol: &SymbolRecord) -> &[NodeId] {
        let start = symbol.declarations_start as usize;
        self.declarations
            .get(start..start + symbol.declarations_len as usize)
            .unwrap_or(&[])
    }

    fn table(&self, local: usize) -> Option<&TableRecord> {
        if local == 0 {
            return None;
        }
        self.tables.get(local)
    }

    fn entries(&self, record: &TableRecord) -> &[TableEntry] {
        let start = record.entries_start as usize;
        self.table_entries
            .get(start..start + record.len as usize)
            .unwrap_or(&[])
    }

    // `len(table)` of a table of the binder.
    pub(crate) fn table_len(&self, local: usize) -> usize {
        self.table(local).map_or(0, |record| record.len as usize)
    }
}

impl File {
    pub fn base(&self) -> u32 {
        self.base
    }

    pub fn span(&self) -> u32 {
        self.span
    }

    // What the binder left, once the file is bound.
    pub fn bound(&self) -> Option<&Bound> {
        self.bound.get()
    }

    // The nodes of the file, the nil record not counted.
    pub fn node_count(&self) -> u32 {
        self.records.len().saturating_sub(1) as u32
    }

    pub fn list_count(&self) -> u32 {
        self.lists.len().saturating_sub(1) as u32
    }

    pub fn slot_count(&self) -> u32 {
        self.slots.len() as u32
    }

    pub fn late_count(&self) -> u32 {
        self.late_len
    }

    // The faults of the producer: the first ones in the order they were recorded.
    pub fn faults(&self) -> &[Fault] {
        &self.faults
    }

    // The number of faults of the producer, the ones that were not kept included.
    pub fn fault_count(&self) -> u32 {
        self.fault_count
    }

    // SourceFile.Text()
    pub fn source_text(&self) -> &[u8] {
        self.text_bytes
            .get(..self.source_file.text_len as usize)
            .unwrap_or(&[])
    }

    // The bytes of the node texts that are no slice of the source text, such as an identifier with an escape.
    pub fn copied_text_len(&self) -> usize {
        self.text_bytes
            .len()
            .saturating_sub(self.source_file.text_len as usize)
    }

    // SourceFile.ECMALineMap()
    pub fn ecma_line_map(&self) -> &[TextPos] {
        self.ecma_line_map
            .get_or_init(|| compute_ecma_line_starts(self.source_text()))
    }

    // The bytes that the file keeps on the heap.
    pub fn heap_bytes(&self) -> usize {
        self.records.capacity() * size_of::<NodeRecord>()
            + self.flags.capacity() * size_of::<NodeFlags>()
            + self.slots.capacity() * size_of::<u32>()
            + self.lists.capacity() * size_of::<ListRecord>()
            + self.list_items.capacity() * size_of::<NodeId>()
            + self.texts.capacity() * size_of::<TextSpan>()
            + self.text_bytes.capacity()
            + self.jsdoc.capacity() * size_of::<(NodeId, NodeListId)>()
            + self.source_file.file_name.capacity()
            + self.bound().map_or(0, Bound::heap_bytes)
    }

    #[inline]
    pub(crate) fn record(&self, local: usize) -> Option<&NodeRecord> {
        if local == 0 {
            return None;
        }
        self.records.get(local)
    }

    #[inline]
    pub(crate) fn node_flags(&self, local: usize) -> NodeFlags {
        self.flags.get(local).copied().unwrap_or(NodeFlags::NONE)
    }

    #[inline]
    pub(crate) fn list(&self, local: usize) -> Option<&ListRecord> {
        if local == 0 {
            return None;
        }
        self.lists.get(local)
    }

    #[inline]
    pub(crate) fn list_nodes(&self, list: &ListRecord) -> &[NodeId] {
        let start = list.start as usize;
        self.list_items
            .get(start..start + list.len as usize)
            .unwrap_or(&[])
    }

    #[inline]
    pub(crate) fn text(&self, handle: u32) -> &[u8] {
        match self.texts.get(handle as usize) {
            Some(span) => self.span_bytes(*span),
            None => &[],
        }
    }

    #[inline]
    fn span_bytes(&self, span: TextSpan) -> &[u8] {
        let start = span.start as usize;
        self.text_bytes
            .get(start..start + span.len as usize)
            .unwrap_or(&[])
    }

    // Where `text` lies in the bytes of the file, when it is a slice of them.
    pub(crate) fn span_of(&self, text: &[u8]) -> Option<TextSpan> {
        span_in(&self.text_bytes, text)
    }

    // A name of the binder: a slice of the bytes of the file, or of the bytes that the binder added.
    #[inline]
    pub(crate) fn name<'f>(&'f self, bound: &'f Bound, span: TextSpan) -> &'f [u8] {
        if span.start & OPEN_BIT == 0 {
            return self.span_bytes(span);
        }
        bound.own_bytes(span)
    }

    // `table[name]` of a table of the binder.
    pub(crate) fn table_lookup(&self, bound: &Bound, local: usize, name: &[u8]) -> SymbolId {
        let Some(record) = bound.table(local) else {
            return SymbolId::NIL;
        };
        let entries = bound.entries(record);
        let position = if record.index_len == 0 {
            entries
                .iter()
                .position(|entry| self.name(bound, entry.name) == name)
        } else {
            let start = record.index_start as usize;
            let index = bound
                .table_index
                .get(start..start + record.index_len as usize)
                .unwrap_or(&[]);
            index_find(index, name, |position| {
                entries
                    .get(position)
                    .map(|entry| self.name(bound, entry.name))
            })
        };
        position
            .and_then(|position| entries.get(position))
            .map_or(SymbolId::NIL, |entry| entry.symbol)
    }

    // The entry at a position of the insertion order of a table of the binder.
    pub(crate) fn table_entry_at<'f>(
        &'f self,
        bound: &'f Bound,
        local: usize,
        position: usize,
    ) -> Option<(&'f [u8], SymbolId)> {
        let entry = bound.entries(bound.table(local)?).get(position)?;
        Some((self.name(bound, entry.name), entry.symbol))
    }

    pub(crate) fn jsdoc_of(&self, host: NodeId) -> NodeListId {
        match self.jsdoc.binary_search_by(|entry| entry.0.cmp(&host)) {
            Ok(at) => self.jsdoc.get(at).map_or(NodeListId::NIL, |entry| entry.1),
            Err(_) => NodeListId::NIL,
        }
    }
}

// `node.AsSourceFile()`: the two children of the node, the fields of the binder, and what the file keeps beside its tree.
#[derive(Clone, Copy)]
pub struct SourceFile<'a> {
    pub statements: NodeListId,
    pub end_of_file_token: NodeId,
    pub symbol: SymbolId,
    pub locals: SymbolTableId,
    pub next_container: NodeId,
    pub language_variant: LanguageVariant,
    pub script_kind: ScriptKind,
    pub is_declaration_file: bool,
    pub uses_uri_style_node_core_modules: Tristate,
    pub identifier_count: u32,
    pub module_augmentations: &'a [NodeId],
    pub ambient_module_names: &'a [Vec<u8>],
    pub comment_directives: &'a [CommentDirective],
    pub reparsed_clones: &'a [NodeId],
    pub pragmas: &'a [Pragma],
    pub referenced_files: &'a [FileReference],
    pub type_reference_directives: &'a [FileReference],
    pub lib_reference_directives: &'a [FileReference],
    pub check_js_directive: Option<CheckJsDirective>,
    pub node_count: u32,
    pub text_count: u32,
    pub common_js_module_indicator: NodeId,
    pub external_module_indicator: NodeId,
    // Fields set by binder
    pub symbol_count: isize,
    pub pattern_ambient_modules: &'a [PatternAmbientModule],
    pub global_exports: SymbolTableId,
    // None for a SourceFile node of an open store, which no file holds.
    pub(crate) file: Option<&'a File>,
}

impl<'a> SourceFile<'a> {
    // The view of a SourceFile node that is no root of a file: everything beside the node is empty.
    pub(crate) fn detached(statements: NodeListId, end_of_file_token: NodeId) -> Self {
        Self {
            statements,
            end_of_file_token,
            symbol: SymbolId::NIL,
            locals: SymbolTableId::NIL,
            next_container: NodeId::NIL,
            language_variant: LanguageVariant::default(),
            script_kind: ScriptKind::default(),
            is_declaration_file: false,
            uses_uri_style_node_core_modules: Tristate::default(),
            identifier_count: 0,
            module_augmentations: &[],
            ambient_module_names: &[],
            comment_directives: &[],
            reparsed_clones: &[],
            pragmas: &[],
            referenced_files: &[],
            type_reference_directives: &[],
            lib_reference_directives: &[],
            check_js_directive: None,
            node_count: 0,
            text_count: 0,
            common_js_module_indicator: NodeId::NIL,
            external_module_indicator: NodeId::NIL,
            symbol_count: 0,
            pattern_ambient_modules: &[],
            global_exports: SymbolTableId::NIL,
            file: None,
        }
    }

    // The view of the root of `file`, without the fields that the binder sets.
    pub(crate) fn of_file(
        file: &'a File,
        statements: NodeListId,
        end_of_file_token: NodeId,
    ) -> Self {
        let data = &file.source_file;
        Self {
            language_variant: data.language_variant,
            script_kind: data.script_kind,
            is_declaration_file: data.is_declaration_file,
            uses_uri_style_node_core_modules: data.uses_uri_style_node_core_modules,
            identifier_count: data.identifier_count,
            module_augmentations: &data.module_augmentations,
            ambient_module_names: &data.ambient_module_names,
            comment_directives: &data.comment_directives,
            reparsed_clones: &data.reparsed_clones,
            pragmas: &data.pragmas,
            referenced_files: &data.referenced_files,
            type_reference_directives: &data.type_reference_directives,
            lib_reference_directives: &data.lib_reference_directives,
            check_js_directive: data.check_js_directive,
            node_count: data.node_count,
            text_count: data.text_count,
            common_js_module_indicator: data.common_js_module_indicator,
            external_module_indicator: data.external_module_indicator,
            file: Some(file),
            ..Self::detached(statements, end_of_file_token)
        }
    }

    // SourceFile.Text()
    pub fn text(&self) -> &'a [u8] {
        match self.file {
            Some(file) => file.source_text(),
            None => &[],
        }
    }

    // SourceFile.FileName()
    pub fn file_name(&self) -> &'a [u8] {
        match self.file {
            Some(file) => &file.source_file.file_name,
            None => &[],
        }
    }

    // SourceFile.Path(): the empty path for a SourceFile node that no file holds.
    pub fn path(&self) -> &'a Path {
        static NO_PATH: Path = Path(Vec::new());
        match self.file {
            Some(file) => &file.source_file.path,
            None => &NO_PATH,
        }
    }

    // SourceFile.Imports()
    pub fn imports(&self) -> &'a [NodeId] {
        match self.file {
            Some(file) => &file.source_file.imports,
            None => &[],
        }
    }

    // SourceFile.Diagnostics(): the parse diagnostics, ids of `diagnostic_store`.
    pub fn diagnostics(&self) -> &'a [DiagnosticId] {
        match self.file {
            Some(file) => &file.source_file.diagnostics,
            None => &[],
        }
    }

    // The store of the parser of the file: None for a SourceFile node that no file holds.
    pub fn diagnostic_store(&self) -> Option<&'a DiagnosticStore> {
        self.file.map(|file| &file.source_file.diagnostic_store)
    }

    // SourceFile.BindDiagnostics(): ids of `bind_diagnostic_store`, none before the binding of the file has ended.
    pub fn bind_diagnostics(&self) -> &'a [DiagnosticId] {
        match self.file.and_then(File::bound) {
            Some(bound) => &bound.bind_diagnostics,
            None => &[],
        }
    }

    // The store of the binder of the file: None until the file is bound.
    pub fn bind_diagnostic_store(&self) -> Option<&'a DiagnosticStore> {
        self.file
            .and_then(File::bound)
            .map(|bound| &bound.bind_diagnostic_store)
    }

    // SourceFile.ECMALineMap()
    pub fn ecma_line_map(&self) -> &'a [TextPos] {
        match self.file {
            Some(file) => file.ecma_line_map(),
            None => &[],
        }
    }

    // SourceFile.IsBound()
    pub fn is_bound(&self) -> bool {
        self.file.is_some_and(|file| file.bound().is_some())
    }
}

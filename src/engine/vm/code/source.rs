use core::cell::{Cell, OnceCell, RefCell};
use core::ffi::c_void;
use core::ops::{Deref, Range};
use core::ptr::NonNull;
use core::sync::atomic::{AtomicU32, AtomicUsize, Ordering, fence};
use std::sync::{Arc, OnceLock};

use bun_engine_bytecode::Directives;
use bun_engine_bytecode::cache::{CachedLines, Payload};
use bun_engine_macros::FieldOffsets;
use bun_engine_syntax::LineTable;
use bun_engine_text::{StringRef, Text};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum SourceType {
    Program,
    Module,
    WebAssembly,
    Json,
    Text,
    Synthetic,
    ImportMap,
    /// A module whose imports and exports the embedder knows without parsing it.
    AnalyzedModule,
    Css,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Default)]
#[repr(C)]
pub struct LineColumn {
    pub line: u32,
    pub column: u32,
}

/// A text and where it came from. The embedder extends it in C++.
#[derive(FieldOffsets)]
#[repr(C)]
pub struct SourceProvider {
    /// Null unless C++ made it.
    embedder_vtable: *const c_void,
    ref_count: AtomicU32,
    source_type: SourceType,
    has_live_exports: Cell<bool>,
    may_reexport_types: Cell<bool>,
    /// The text has never been a value of the program.
    is_static: bool,
    /// Zero until it is asked for, unless the embedder knows it.
    hash: Cell<u32>,
    /// Where the text starts in its document, from zero.
    start_line: i32,
    start_column: i32,
    source: StringRef,
    /// The last field whose offset C++ knows.
    url: Option<StringRef>,
    id: Cell<usize>,
    source_url_directive: RefCell<Option<StringRef>>,
    source_mapping_url_directive: RefCell<Option<StringRef>>,
    /// For text that was made at run time: that of the code which made it.
    origin: Option<SourceProviderRef>,
    /// Is reachable for as long as code from this text is. Null for none.
    opaque_root: *const c_void,
    lines: OnceCell<Arc<Lines>>,
    bytecode: OnceCell<StoredCode>,
}

/// For all providers of a text.
pub(super) enum Lines {
    Stored(CachedLines),
    Found(Vec<u8>),
}

/// What another process has made of the text.
pub(super) struct StoredCode {
    pub(super) payload: Payload,
    /// Where it has the code of this text.
    pub(super) entry: u32,
    pub(super) identity: Option<u64>,
}

static DELETE_EMBEDDER_PROVIDER: OnceLock<unsafe extern "C" fn(*mut SourceProvider)> =
    OnceLock::new();

pub struct SourceProviderBuilder(Box<SourceProvider>);

impl SourceProviderBuilder {
    pub fn start_position(mut self, line: i32, column: i32) -> SourceProviderBuilder {
        (self.0.start_line, self.0.start_column) = (line, column);
        self
    }

    pub fn origin(mut self, origin: Option<&SourceProvider>) -> SourceProviderBuilder {
        self.0.origin = origin.map(|origin| SourceProviderRef::retain(origin.origin()));
        self.opaque_root(origin.map_or_default(SourceProvider::opaque_root))
    }

    pub fn is_static(mut self, is_static: bool) -> SourceProviderBuilder {
        self.0.is_static = is_static;
        self
    }

    pub fn opaque_root(mut self, root: *const c_void) -> SourceProviderBuilder {
        self.0.opaque_root = root;
        self
    }

    /// # Safety
    /// `place` is the start of an object of C++, which has written nothing but the vtable.
    pub unsafe fn finish_in(mut self, place: *mut SourceProvider) {
        // SAFETY: the caller's.
        unsafe {
            self.0.embedder_vtable = (&raw const (*place).embedder_vtable).read();
            place.write(*self.0);
        }
    }

    pub fn finish(self) -> SourceProviderRef {
        SourceProviderRef(NonNull::from(Box::leak(self.0)))
    }
}

impl SourceProvider {
    pub fn build(
        source: StringRef,
        url: Option<StringRef>,
        source_type: SourceType,
    ) -> SourceProviderBuilder {
        SourceProviderBuilder(Box::new(SourceProvider {
            embedder_vtable: core::ptr::null(),
            ref_count: AtomicU32::new(1),
            source_type,
            has_live_exports: Cell::new(false),
            may_reexport_types: Cell::new(false),
            is_static: false,
            hash: Cell::new(0),
            id: Cell::new(0),
            source,
            url,
            source_url_directive: RefCell::new(None),
            source_mapping_url_directive: RefCell::new(None),
            start_line: 0,
            start_column: 0,
            origin: None,
            opaque_root: core::ptr::null(),
            lines: OnceCell::new(),
            bytecode: OnceCell::new(),
        }))
    }

    /// # Safety
    /// `delete` destroys and frees a provider that has a vtable.
    pub unsafe fn set_embedder_deleter(delete: unsafe extern "C" fn(*mut SourceProvider)) {
        DELETE_EMBEDDER_PROVIDER.get_or_init(|| delete);
    }

    pub fn is_from_embedder(&self) -> bool {
        !self.embedder_vtable.is_null()
    }

    pub fn is_static(&self) -> bool {
        self.is_static
    }

    pub fn source(&self) -> &StringRef {
        &self.source
    }

    pub fn text(&self) -> Text<'_> {
        self.source.text()
    }

    pub fn url(&self) -> Option<&StringRef> {
        self.url.as_ref()
    }

    pub fn source_type(&self) -> SourceType {
        self.source_type
    }

    /// Equal for equal texts, or they do not share their code.
    pub fn hash(&self) -> u32 {
        if self.hash.get() == 0 {
            self.hash.set(self.source.hash());
        }
        self.hash.get()
    }

    /// Whether importers ask the module for the value of an export each time they read it.
    pub fn has_live_exports(&self) -> &Cell<bool> {
        &self.has_live_exports
    }

    /// Whether the module was TypeScript, where what looks like a value of another module may be a type.
    pub fn may_reexport_types(&self) -> &Cell<bool> {
        &self.may_reexport_types
    }

    /// Line and column, from zero.
    pub fn start_position(&self) -> (i32, i32) {
        (self.start_line, self.start_column)
    }

    /// What `import()` in the text is relative to.
    pub fn origin(&self) -> &SourceProvider {
        self.origin.as_deref().unwrap_or(self)
    }

    pub(super) fn opaque_root(&self) -> *const c_void {
        self.opaque_root
    }

    pub fn id(&self) -> usize {
        static NEXT: AtomicUsize = AtomicUsize::new(2);
        if self.id.get() == 0 {
            self.id.set(NEXT.fetch_add(1, Ordering::Relaxed));
        }
        self.id.get()
    }

    pub fn source_url_directive(&self) -> Option<StringRef> {
        self.source_url_directive.borrow().clone()
    }

    pub fn source_mapping_url_directive(&self) -> Option<StringRef> {
        self.source_mapping_url_directive.borrow().clone()
    }

    pub fn set_directives(&self, directives: &Directives) {
        self.source_url_directive
            .replace(directives.source_url.clone());
        self.source_mapping_url_directive
            .replace(directives.source_mapping_url.clone());
    }

    /// Whether `lines` does without reading the text.
    pub fn has_lines(&self) -> bool {
        self.lines.get().is_some()
    }

    /// All is on one line if there is no memory for more.
    pub fn lines(&self) -> LineTable<'_> {
        let find = || Lines::Found(LineTable::encode(self.text()).unwrap_or_default());
        let table = match &**self.lines.get_or_init(|| Arc::new(find())) {
            Lines::Stored(lines) => lines.table(),
            Lines::Found(bytes) => LineTable::read(bytes),
        };
        table.unwrap_or_default()
    }

    pub(super) fn set_cached_lines(&self, lines: Option<CachedLines>) {
        self.share_lines(lines.map(|it| Arc::new(Lines::Stored(it))));
    }

    pub(super) fn shared_lines(&self) -> Option<Arc<Lines>> {
        self.lines.get().cloned()
    }

    /// Those of a provider of the same text.
    pub(super) fn share_lines(&self, lines: Option<Arc<Lines>>) {
        if let Some(lines) = lines {
            self.lines.get_or_init(|| lines);
        }
    }

    /// What may spare compiling the text. A module in there has no completion value.
    pub fn set_bytecode(&self, payload: Payload, entry: u32) {
        let identity = (!payload.is_embedded()).then(|| self.text().fingerprint());
        if let Some(identity) = identity {
            self.hash.set(identity as u32);
        }
        self.bytecode.get_or_init(|| StoredCode {
            payload,
            entry,
            identity,
        });
    }

    pub(super) fn bytecode(&self) -> Option<&StoredCode> {
        self.bytecode.get()
    }

    /// From zero, and not counting where the text starts in its document.
    pub fn position_in_text(&self, offset: u32) -> LineColumn {
        let (line, column) = self.lines().line_and_column(offset);
        LineColumn { line, column }
    }

    /// From one.
    pub fn position_in_document(&self, offset: u32) -> LineColumn {
        let LineColumn { line, column } = self.position_in_text(offset);
        let shift = if line == 0 { self.start_column } else { 0 };
        LineColumn {
            line: (line + 1).wrapping_add_signed(self.start_line),
            column: (column + 1).wrapping_add_signed(shift),
        }
    }
}

#[repr(transparent)]
pub struct SourceProviderRef(NonNull<SourceProvider>);

impl SourceProviderRef {
    /// # Safety
    /// The caller hands over a reference that it holds.
    pub unsafe fn from_raw(provider: NonNull<SourceProvider>) -> SourceProviderRef {
        SourceProviderRef(provider)
    }

    pub(super) fn into_raw(self) -> NonNull<SourceProvider> {
        core::mem::ManuallyDrop::new(self).0
    }

    pub fn retain(provider: &SourceProvider) -> SourceProviderRef {
        provider.ref_count.fetch_add(1, Ordering::Relaxed);
        SourceProviderRef(NonNull::from(provider))
    }
}

impl Deref for SourceProviderRef {
    type Target = SourceProvider;

    #[inline(always)]
    fn deref(&self) -> &SourceProvider {
        // SAFETY: counted.
        unsafe { self.0.as_ref() }
    }
}

impl Clone for SourceProviderRef {
    fn clone(&self) -> SourceProviderRef {
        self.ref_count.fetch_add(1, Ordering::Relaxed);
        SourceProviderRef(self.0)
    }
}

impl Drop for SourceProviderRef {
    fn drop(&mut self) {
        if self.ref_count.fetch_sub(1, Ordering::Release) != 1 {
            return;
        }
        fence(Ordering::Acquire);
        // SAFETY: the last reference, to what either C++ or `build` allocated.
        unsafe {
            if self.is_from_embedder() {
                let delete = DELETE_EMBEDDER_PROVIDER
                    .get()
                    .expect("set with the first Vm");
                delete(self.0.as_ptr());
            } else {
                drop(Box::from_raw(self.0.as_ptr()));
            }
        }
    }
}

/// A part of a text.
#[derive(Clone, FieldOffsets)]
#[repr(C)]
pub struct SourceCode {
    pub provider: SourceProviderRef,
    pub start: u32,
    pub end: u32,
}

impl SourceCode {
    pub fn whole(provider: SourceProviderRef) -> SourceCode {
        let end = provider.text().len() as u32;
        SourceCode {
            provider,
            start: 0,
            end,
        }
    }

    pub fn range(&self) -> Range<u32> {
        self.start..self.end
    }

    pub fn text(&self) -> Text<'_> {
        self.provider
            .text()
            .slice(self.start as usize..self.end as usize)
    }
}

use core::ffi::c_void;

use crate::Ordinal;
use crate::internal_source_map::ObjectBrace;

use crate::mapping;
use crate::{
    InternalSourceMap, Mapping, ParseUrl, ParseUrlResultHint, SourceMapLoadHint, SourceProvider,
    SourceProviderMap,
};

/// ParsedSourceMap can be acquired by different threads via the thread-safe
/// source map store (SavedSourceMap), so the reference count must be thread-safe.
pub struct ParsedSourceMap {
    pub mappings: mapping::List,
    /// Set when this map's mappings are backed by an InternalSourceMap blob
    /// instead of a materialized `Mapping.List`. The blob is *owned* (freed in
    /// `Drop`) unless [`Self::is_standalone_module_graph`] — in that case the
    /// bytes live in the embedded `bun build --compile` section and are
    /// borrowed.
    pub(crate) internal: Option<InternalSourceMap>,

    /// If this is empty, this implies that the source code is a single file
    /// transpiled on-demand. If there are items, then it means this is a file
    /// loaded without transpilation but with external sources. This array
    /// maps `source_index` to the correct filename.
    pub external_source_names: Vec<Box<[u8]>>,
    /// In order to load source contents from a source-map after the fact,
    /// a handle to the underlying source provider is stored, along with a
    /// load hint recording whether the map is known to be inline or external.
    ///
    /// Source contents are large, we don't preserve them in memory. This has
    /// the downside of repeatedly re-decoding sourcemaps if multiple errors
    /// are emitted (specifically with Bun.inspect / unhandled; the ones that
    /// rely on source contents)
    pub underlying_provider: SourceContentPtr,

    pub is_standalone_module_graph: bool,
}

impl Drop for ParsedSourceMap {
    fn drop(&mut self) {
        // When the mappings are backed
        // by an `InternalSourceMap` blob the blob is *owned* (what the printer
        // made, see `SourceMapBlob::into_parsed`) unless this is the
        // standalone-module-graph case where the bytes live in the embedded
        // section. The doc on the `internal` field only describes that latter
        // borrowed case.
        //
        // `mappings`/`external_source_names` free via their own `Drop`.
        if let Some(ism) = self.internal.take() {
            if !self.is_standalone_module_graph {
                ism.free_owned();
            }
        }
    }
}

impl Default for ParsedSourceMap {
    fn default() -> Self {
        Self {
            mappings: mapping::List::default(),
            internal: None,
            external_source_names: Vec::new(),
            underlying_provider: SourceContentPtr::NONE,
            is_standalone_module_graph: false,
        }
    }
}

/// Type-erased `get_source_map` dispatch for a provider handle stored in a
/// [`SourceContentPtr`]: one monomorphization of [`erased_get_source_map`]
/// per [`SourceProvider`] impl. The handle round-trips as a plain pointer
/// without this module naming any concrete provider type.
pub type ErasedGetSourceMap = unsafe fn(
    provider: *mut c_void,
    source_filename: &[u8],
    load_hint: SourceMapLoadHint,
    result: ParseUrlResultHint,
) -> Option<ParseUrl>;

/// # Safety
/// `provider` must be the pointer packed by
/// [`SourceContentPtr::from_source_provider`] for the same `P`, still live.
unsafe fn erased_get_source_map<P: SourceProvider>(
    provider: *mut c_void,
    source_filename: &[u8],
    load_hint: SourceMapLoadHint,
    result: ParseUrlResultHint,
) -> Option<ParseUrl> {
    // SAFETY: caller contract — `provider` originates from
    // `SourceContentPtr::from_source_provider::<P>`, so it is a live
    // `*const P` for the duration of this call.
    let provider = unsafe { &*provider.cast::<P>() };
    crate::get_source_map_impl(provider, source_filename, load_hint, result)
}

/// An erased source provider: the raw FFI handle plus the `get_source_map`
/// dispatch monomorphized for its concrete type. Recovered from a
/// [`SourceContentPtr`], or stored whole (boxed) where the pair must travel
/// together (`bun_jsc::SavedSourceMap`'s provider entries).
#[derive(Clone, Copy)]
pub struct AnySourceProvider {
    ptr: *mut c_void,
    get_source_map: ErasedGetSourceMap,
}

impl AnySourceProvider {
    /// Erases a provider handle. Like [`SourceContentPtr::from_source_provider`],
    /// `p` must stay live for as long as the returned value (or any copy of
    /// it) is dispatched through.
    pub fn new<P: SourceProvider>(p: *const P) -> AnySourceProvider {
        AnySourceProvider {
            ptr: p.cast_mut().cast::<c_void>(),
            get_source_map: erased_get_source_map::<P>,
        }
    }

    /// A map that `get_source_map` reads for `ptr` without a [`SourceProvider`] impl (one that is embedded in the
    /// executable).
    pub fn from_fn(ptr: *mut c_void, get_source_map: ErasedGetSourceMap) -> AnySourceProvider {
        AnySourceProvider {
            ptr,
            get_source_map,
        }
    }

    pub fn ptr(&self) -> *mut c_void {
        self.ptr
    }

    pub fn get_source_map(
        &self,
        source_filename: &[u8],
        load_hint: SourceMapLoadHint,
        result: ParseUrlResultHint,
    ) -> Option<ParseUrl> {
        // SAFETY: `ptr` and `get_source_map` were packed together by a constructor of this type or by
        // `SourceContentPtr::from_source_provider`. The provider is live: `bun_jsc::SavedSourceMap` gives this out
        // for a provider that is registered there, to a caller that asks before the JS thread can destroy one. A
        // `ParsedSourceMap` that outlives its provider (a coverage row holds one) is never asked.
        unsafe { (self.get_source_map)(self.ptr, source_filename, load_hint, result) }
    }
}

/// A provider handle (stored as a raw address in `data`), the erased
/// `get_source_map` dispatch for its concrete type, and a load hint.
#[derive(Copy, Clone)]
pub struct SourceContentPtr {
    data: u64,
    load_hint: SourceMapLoadHint,
    get_source_map: Option<ErasedGetSourceMap>,
}

impl SourceContentPtr {
    pub(crate) const NONE: SourceContentPtr = SourceContentPtr {
        data: 0,
        load_hint: SourceMapLoadHint::None,
        get_source_map: None,
    };

    #[inline]
    pub(crate) fn load_hint(self) -> SourceMapLoadHint {
        self.load_hint
    }

    #[inline]
    pub(crate) fn set_load_hint(&mut self, hint: SourceMapLoadHint) {
        self.load_hint = hint;
    }

    #[inline]
    pub(crate) fn data(self) -> u64 {
        self.data
    }

    /// Pack a provider handle. [`Self::provider`] recovers it together with
    /// the `get_source_map` dispatch for `P`.
    pub fn from_source_provider<P: SourceProvider>(p: *const P) -> SourceContentPtr {
        SourceContentPtr {
            data: u64::try_from(p as usize).expect("int cast"),
            load_hint: SourceMapLoadHint::None,
            get_source_map: Some(erased_get_source_map::<P>),
        }
    }

    /// `SourceProviderMap` packing helper. Also used by the standalone module
    /// graph, which stores a `*mut SerializedSourceMap::Loaded` here (guarded
    /// by [`ParsedSourceMap::is_standalone_module_graph`], so the provider
    /// dispatch is never invoked for it).
    pub fn from_provider(p: *const SourceProviderMap) -> SourceContentPtr {
        Self::from_source_provider(p)
    }

    pub fn provider(self) -> Option<AnySourceProvider> {
        Some(AnySourceProvider {
            ptr: self.data as usize as *mut c_void,
            get_source_map: self.get_source_map?,
        })
    }
}

impl ParsedSourceMap {
    /// Construct a `ParsedSourceMap` whose mappings are backed by an
    /// `InternalSourceMap` blob (e.g. one embedded in a `bun build --compile`
    /// executable's standalone module graph) instead of a materialized
    /// `mapping::List`. Ownership of the blob transfers to the returned value
    /// (freed in `Drop`) unless the caller subsequently sets
    /// [`Self::is_standalone_module_graph`].
    pub fn from_internal(internal: InternalSourceMap) -> Self {
        Self {
            mappings: mapping::List::default(),
            internal: Some(internal),
            external_source_names: Vec::new(),
            underlying_provider: SourceContentPtr::NONE,
            is_standalone_module_graph: false,
        }
    }

    pub fn is_external(&self) -> bool {
        !self.external_source_names.is_empty()
    }

    pub fn find_mapping(&self, line: Ordinal, column: Ordinal) -> Option<Mapping> {
        if let Some(ism) = &self.internal {
            return ism.find(line, column);
        }
        self.mappings.find(line, column)
    }

    /// Every mapping, in generated order.
    pub fn for_each_mapping(&self, mut each: impl FnMut(Mapping)) {
        if let Some(ism) = &self.internal {
            return ism.for_each(each);
        }
        let (generated, original, source_index) = (
            self.mappings.generated(),
            self.mappings.original(),
            self.mappings.source_index(),
        );
        for i in 0..generated.len() {
            each(Mapping {
                generated: generated[i],
                original: original[i],
                source_index: source_index[i],
                name_index: -1,
            });
        }
    }

    /// The mappings of the braces of object literals, if the printer marked them.
    pub fn for_each_object_brace(&self, each: impl FnMut(ObjectBrace)) {
        if let Some(ism) = &self.internal {
            ism.for_each_object_brace(each);
        }
    }

    pub(crate) fn standalone_module_graph_data(&self) -> *mut crate::SerializedSourceMap::Loaded {
        debug_assert!(self.is_standalone_module_graph);
        self.underlying_provider.data() as usize as *mut crate::SerializedSourceMap::Loaded
    }

    pub fn memory_cost(&self) -> usize {
        let mappings_cost = if let Some(ism) = &self.internal {
            ism.memory_cost()
        } else {
            self.mappings.memory_cost()
        };
        core::mem::size_of::<ParsedSourceMap>()
            + mappings_cost
            + self.external_source_names.len() * core::mem::size_of::<Box<[u8]>>()
    }
}

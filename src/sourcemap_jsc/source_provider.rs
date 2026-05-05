//! `BakeSourceProvider` — the only `*SourceProvider` variant whose external
//! sourcemap lookup needs the live `Bake::GlobalObject`. The opaque + its
//! `get_external_data` live here so `src/sourcemap/` has no JSC types;
//! `get_source_map_impl` calls it via a trait bound (Zig used
//! `@hasDecl(SourceProviderKind, "getExternalData")`).

use core::marker::{PhantomData, PhantomPinned};

use bun_jsc::JSGlobalObject;
use bun_sourcemap::{self as source_map, ParseUrl, ParseUrlResultHint, SourceMapLoadHint};
use bun_str::String as BunString;

// TODO(port): move to sourcemap_jsc_sys (or bake_sys) — extern decls
unsafe extern "C" {
    fn BakeGlobalObject__isBakeGlobalObject(global: *mut JSGlobalObject) -> bool;
    // TODO(b2-blocked): bun_runtime::bake::production::PerThread — gated upstream;
    // signature uses opaque `*mut c_void` until that type is available.
    fn BakeGlobalObject__getPerThreadData(global: *mut JSGlobalObject) -> *mut core::ffi::c_void;
    fn BakeSourceProvider__getSourceSlice(this: *mut BakeSourceProvider) -> BunString;
}

/// Opaque FFI handle; the C++ side owns the storage.
#[repr(C)]
pub struct BakeSourceProvider {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

impl BakeSourceProvider {
    #[inline]
    pub fn get_source_slice(&mut self) -> BunString {
        // SAFETY: `self` is a live `*BakeSourceProvider` handed back to C++.
        unsafe { BakeSourceProvider__getSourceSlice(self as *mut Self) }
    }

    pub fn to_source_content_ptr(&mut self) -> source_map::parsed_source_map::SourceContentPtr {
        // PORT NOTE: `bun_sourcemap` defines its own opaque `BakeSourceProvider` so it
        // can name the pointer without a tier-6 dep. Both are `#[repr(C)]` ZST opaques
        // for the same C++ type, so the pointer cast is layout-correct.
        source_map::parsed_source_map::SourceContentPtr::from_bake_provider(
            (self as *mut Self).cast::<source_map::BakeSourceProvider>(),
        )
    }

    /// Returns the pre-bundled sourcemap JSON for `source_filename` if the
    /// current global is a `Bake::GlobalObject`; `None` otherwise (caller falls
    /// back to reading `<source>.map` from disk).
    // TODO(port): returned slice borrows from `PerThread.bundled_outputs`; lifetime
    // is not expressible against `&mut self`. Phase B: thread `'pt` or return owned.
    pub fn get_external_data(&mut self, source_filename: &[u8]) -> Option<&'static [u8]> {
        #[cfg(any())]
        {
            // TODO(b2-blocked): bun_jsc::VirtualMachine::get
            // TODO(b2-blocked): bun_runtime::bake::production::PerThread
            let global = bun_jsc::VirtualMachine::get().global;
            // SAFETY: `global` is the live JSGlobalObject for this VM thread.
            if !unsafe { BakeGlobalObject__isBakeGlobalObject(global as *const _ as *mut _) } {
                return None;
            }
            // SAFETY: checked above that this is a Bake global; C++ guarantees non-null.
            let pt: &bun_runtime::bake::production::PerThread = unsafe {
                &*BakeGlobalObject__getPerThreadData(global as *const _ as *mut _).cast()
            };
            if let Some(value) = pt.source_maps.get(source_filename) {
                return Some(pt.bundled_outputs[value.get()].value.as_slice());
            }
            return Some(b"");
        }
        let _ = source_filename;
        None
    }

    /// The last two arguments to this specify loading hints
    pub fn get_source_map(
        &mut self,
        source_filename: &[u8],
        load_hint: SourceMapLoadHint,
        result: ParseUrlResultHint,
    ) -> Option<ParseUrl> {
        #[cfg(any())]
        {
            // TODO(b2-blocked): bun_sourcemap::get_source_map_impl
            return source_map::get_source_map_impl::<BakeSourceProvider>(
                self,
                source_filename,
                load_hint,
                result,
            );
        }
        let _ = (source_filename, load_hint, result);
        None
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sourcemap_jsc/source_provider.zig (48 lines)
//   confidence: medium
//   todos:      2 gated bodies
//   notes:      get_external_data return lifetime borrows PerThread; @hasDecl dispatch → needs trait in bun_sourcemap
// ──────────────────────────────────────────────────────────────────────────

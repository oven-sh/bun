//! `PerThread`: what each rendering thread needs from the bundle.

use super::*;
use bun_bundler::output_file::Value as OutputFileValue;

/// Data used on each rendering thread. Contains all information in the bundle needed to render.
/// This is referred to as `pt` in variable/field naming, and Bake::ProductionPerThread in C++
///
/// Owns the backing storage so the value can outlive `build_with_vm` in the
/// caller's frame without dangling references.
pub(crate) struct PerThread {
    // Shared Data (owned)
    /// Owns `input_files` (keys) and `output_indexes` (values).
    pub(crate) entry_points: EntryPointMap,
    pub(crate) bundled_outputs: Vec<OutputFile>,
    /// Indexed by entry point index (OpaqueFileId)
    pub(crate) module_keys: Vec<BunString>,
    /// Unordered
    /// Each source owns its chunk's bytes, moved out of `bundled_outputs`: JavaScriptCore keeps it longer than `PerThread` lives.
    pub(crate) module_map: StringArrayHashMap<BunString>,
    pub(crate) source_maps: StringArrayHashMap<OutputFileIndex>,

    // Thread-local
    pub(crate) vm: bun_ptr::BackRef<VirtualMachine, bun_ptr::Mut>,
    /// Indexed by entry point index (OpaqueFileId)
    pub(crate) loaded_files: AutoBitSet,
    /// JSArray of JSString, indexed by entry point index (OpaqueFileId)
    // Strong is required for JSValue struct fields. `None` is the pre-init
    // state; `PerThread::init` fills it. Strong's Drop releases the GC root.
    pub(crate) all_server_files: Option<bun_jsc::Strong>,
    /// `attach()` was called and Drop should detach. The placeholder created in
    /// `build_command` before `init` must not call into C++ on drop.
    attached: bool,
}

// C++ treats `PerThread` as an opaque pointer (Bake::ProductionPerThread*); the Rust
// layout is irrelevant across the FFI boundary, so silence the improper_ctypes lint.
// C++ stores `pt` opaquely on the global (never dereferenced C++-side; null
// detaches), so the call has no precondition beyond a live `&JSGlobalObject`
// — declare `safe fn`.
#[allow(improper_ctypes)]
unsafe extern "C" {
    safe fn BakeGlobalObject__attachPerThreadData(global: &JSGlobalObject, pt: *mut PerThread);
}

impl PerThread {
    /// Safe `&VirtualMachine` accessor for the JSC_BORROW `vm` back-pointer.
    #[inline]
    pub(crate) fn vm(&self) -> &VirtualMachine {
        // BackRef invariant: VM outlives `PerThread` (set in `init`/`placeholder`
        // from `init_bake`).
        self.vm.get()
    }

    /// Safe `&'static JSGlobalObject` accessor — `self.vm().global()`.
    #[inline]
    pub(crate) fn global(&self) -> &'static JSGlobalObject {
        self.vm().global()
    }

    /// Empty placeholder used in `build_command` before `build_with_vm` fills it.
    pub(super) fn placeholder(vm: *mut VirtualMachine) -> PerThread {
        PerThread {
            entry_points: EntryPointMap::default(),
            bundled_outputs: Vec::new(),
            module_keys: Vec::new(),
            module_map: StringArrayHashMap::default(),
            source_maps: StringArrayHashMap::default(),
            // SAFETY: `vm` is the live per-thread VM from `init_bake` (non-null,
            // write provenance); outlives `PerThread`.
            vm: unsafe { bun_ptr::BackRef::from_raw_mut(vm) },
            loaded_files: AutoBitSet::init_empty(0).expect("unreachable"),
            all_server_files: None,
            attached: false,
        }
    }

    /// After initializing, call `attach`
    pub(crate) fn init(
        vm: bun_ptr::BackRef<VirtualMachine, bun_ptr::Mut>,
        entry_points: EntryPointMap,
        mut bundled_outputs: Vec<OutputFile>,
        module_keys: Vec<BunString>,
        module_indexes: &StringArrayHashMap<OutputFileIndex>,
        source_maps: StringArrayHashMap<OutputFileIndex>,
    ) -> crate::Result<PerThread> {
        let n = entry_points.files.count();
        let loaded_files = AutoBitSet::init_empty(n)?;
        // errdefer loaded_files.deinit() — handled by Drop on error path

        let global = vm.global();
        let all_server_files = Some(bun_jsc::Strong::create(
            JSValue::create_empty_array(global, n).map_err(js_err)?,
            global,
        ));

        let mut module_map = StringArrayHashMap::with_capacity(module_indexes.count());
        for (key, index) in module_indexes.keys().iter().zip(module_indexes.values()) {
            let value = &mut bundled_outputs[index.get() as usize].value;
            let source = match core::mem::replace(value, OutputFileValue::Noop) {
                OutputFileValue::Buffer { bytes } => {
                    BunString::create_external_globally_allocated_latin1(bytes.into_vec())
                }
                _ => BunString::EMPTY,
            };
            module_map.put_assume_capacity(key, source);
        }

        Ok(PerThread {
            entry_points,
            bundled_outputs,
            module_keys,
            module_map,
            source_maps,
            vm,
            loaded_files,
            all_server_files,
            attached: false,
        })
    }

    pub(crate) fn attach(&mut self) {
        // `self.global()` derefs the JSC_BORROW `vm` back-pointer (live for the
        // VM lifetime); C++ stores `pt` opaquely and hands it back via
        // `BakeProdResolve`, so passing `from_mut(self)` is just identity —
        // detached in Drop.
        let global = self.global();
        BakeGlobalObject__attachPerThreadData(global, std::ptr::from_mut::<PerThread>(self));
        self.attached = true;
    }

    pub(crate) fn output_index(&self, id: OpaqueFileId) -> OutputFileIndex {
        self.entry_points.files.values()[id.get() as usize]
    }

    pub(crate) fn input_file(&self, id: OpaqueFileId) -> InputFile {
        self.entry_points.files.keys()[id.get() as usize]
    }

    pub(crate) fn output_file(&self, id: OpaqueFileId) -> &OutputFile {
        &self.bundled_outputs[self.output_index(id).get() as usize]
    }

    // Must be run at the top of the event loop
    pub(crate) fn load_bundled_module(&self, id: OpaqueFileId) -> crate::Result<JSValue> {
        let global = self.global();
        load_module(
            self.vm.as_ptr(),
            global,
            self.module_keys[id.get() as usize]
                .to_js(global)
                .map_err(js_err)?,
        )
    }

    /// The JSString entries in `all_server_files` is generated lazily. When
    /// multiple rendering threads are used, unreferenced files will contain
    /// holes in the array used. Returns a JSValue of the "FileIndex" type
    //
    // What could be done here is generating a new index type, which is
    // specifically for referenced files. This would remove the holes, but make
    // it harder to pre-allocate. It's probably worth it.
    pub(crate) fn preload_bundled_module(&mut self, id: OpaqueFileId) -> JsResult<JSValue> {
        let global = self.global();
        if !self.loaded_files.is_set(id.get() as usize) {
            self.loaded_files.set(id.get() as usize);
            self.all_server_files.as_ref().unwrap().get().put_index(
                global,
                id.get(),
                self.module_keys[id.get() as usize].to_js(global)?,
            )?;
        }

        Ok(JSValue::js_number_from_int32(
            i32::try_from(id.get()).expect("int cast"),
        ))
    }
}

impl Drop for PerThread {
    fn drop(&mut self) {
        if self.attached {
            // Passing null detaches the previously-attached pointer; `global()`
            // goes through the safe `vm()` accessor (VM outlives PerThread).
            BakeGlobalObject__attachPerThreadData(self.global(), core::ptr::null_mut());
        }
        // `all_server_files: Strong` is dropped automatically, releasing the GC root.
    }
}

/// Packed: type (u8) | no_client (bool, 1 bit) | unused (u23)
#[repr(transparent)]
#[derive(Clone, Copy)]
pub(crate) struct TypeAndFlags(i32);

impl TypeAndFlags {
    pub(crate) const fn new(ty: u8, no_client: bool) -> Self {
        // type: bits 0..8, no_client: bit 8, unused: bits 9..32
        TypeAndFlags((ty as i32) | ((no_client as i32) << 8))
    }

    pub(crate) const fn bits(self) -> i32 {
        self.0
    }
}

// `fn @"export"()` force-reference block dropped — Rust links what's `pub`.

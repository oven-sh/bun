//! Implements building a Bake application to production

#![allow(unused_imports, unused_variables, dead_code, unreachable_code)]

use core::ffi::c_char;
use std::io::Write as _;

use bstr::BStr;

use bun_alloc::Arena;
use crate::bake as bake;
use crate::bake::framework_router::{self as framework_router, FrameworkRouter, OpaqueFileId};
use super::PatternBuffer;
use bun_bundler::options::{self as bundler_options, OutputFile, SourceMapOption};
use bun_bundler::output_file::Index as OutputFileIndex;
use bun_bundler::BundleV2;

use bun_collections::{ArrayHashMap, AutoBitSet, StringArrayHashMap};
use bun_core::{self as bun, Global, Output};
use bun_dotenv as dotenv;
use bun_http::AsyncHTTP;
use bun_jsc::{self as jsc, JSGlobalObject, JSModuleLoader, JSPromise, JSValue, JsResult};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_paths::{self as path, PathBuffer};
use bun_paths::resolve_path::{self as resolve_path, platform};
use bun_resolver as resolver;
use bun_string::{strings, String as BunString};
use bun_bundler::Transpiler;

bun_core::declare_scope!(production, visible);

macro_rules! log {
    ($($arg:tt)*) => { bun_core::scoped_log!(production, $($arg)*) };
}

// TODO(b2-blocked): `crate::cli::command::Context` — the CLI `Command::Context`
// type is not yet exported from `bun_runtime::cli`. The body of `build_command`
// is gated until that and `VirtualMachine::init_bake` land.
pub fn build_command(/* ctx: Command::Context */) -> Result<(), bun_core::Error> {
    todo!(
        "blocked_on: crate::cli::command::Context, bun_jsc::VirtualMachine::init_bake, \
         crate::cli::bunfig::OfflineMode, crate::cli::command::HotReload, \
         crate::bun_js::fail_with_build_error"
    )
}

pub fn write_sourcemap_to_disk(
    file: &OutputFile,
    bundled_outputs: &[OutputFile],
    source_maps: &mut StringArrayHashMap<OutputFileIndex>,
) -> Result<(), bun_core::Error> {
    // don't call this if the file does not have sourcemaps!
    debug_assert!(file.source_map_index != u32::MAX);

    // TODO: should we just write the sourcemaps to disk?
    let source_map_index = file.source_map_index;
    let source_map_file: &OutputFile = &bundled_outputs[source_map_index as usize];
    debug_assert!(source_map_file.output_kind == OutputKind::Sourcemap);

    let without_prefix = if strings::has_prefix(&file.dest_path, b"./")
        || (cfg!(windows) && strings::has_prefix(&file.dest_path, b".\\"))
    {
        &file.dest_path[2..]
    } else {
        &file.dest_path[..]
    };

    let mut key = Vec::with_capacity(6 + without_prefix.len());
    write!(&mut key, "bake:/{}", BStr::new(without_prefix)).unwrap();
    source_maps.put(
        key.into_boxed_slice(),
        OutputFileIndex(u32::try_from(source_map_index).unwrap()),
    )?;
    Ok(())
}

// TODO(b2-blocked): full body referenced dozens of upstream symbols not yet
// ported (`VirtualMachine` field surface, `BundleV2::generate_from_bake_production_cli`,
// `FrameworkRouter::init_empty`, `framework_router::Part`, `bake::UserOptions::from_js`
// arena wiring, `Transpiler` field access). The Phase-A draft body is preserved
// in git history; un-gate once those land.
pub fn build_with_vm(
    /* ctx: Command::Context, */
    cwd: &[u8],
    vm: &VirtualMachine,
    pt: &mut PerThread,
) -> Result<(), bun_core::Error> {
    let _ = (cwd, vm, pt);
    todo!(
        "blocked_on: bun_bundler::BundleV2::generate_from_bake_production_cli, \
         crate::bake::framework_router::Part, crate::bake::FrameworkRouter::init_empty, \
         bun_jsc::VirtualMachine::{{transpiler,wait_for_promise,event_loop}}, \
         crate::cli::command::Context"
    )
}

/// unsafe function, must be run outside of the event loop
/// quits the process on exception
fn load_module(
    vm: &VirtualMachine,
    global: &JSGlobalObject,
    key: JSValue,
) -> Result<JSValue, bun_core::Error> {
    let _ = (vm, global, key);
    // SAFETY: FFI call; `global` is a live &JSGlobalObject and `key` is a JSValue
    // held on the stack for the duration of the call.
    todo!(
        "blocked_on: bun_jsc::VirtualMachine::wait_for_promise, \
         bun_jsc::AnyPromise::internal, bun_jsc::JSPromise::unwrap"
    )
}

// extern apis:

// TODO: Dedupe
// TODO(port): move to bake_sys
unsafe extern "C" {
    fn BakeGetDefaultExportFromModule(global: *const JSGlobalObject, key: JSValue) -> JSValue;
    fn BakeGetModuleNamespace(global: *const JSGlobalObject, key: JSValue) -> JSValue;
    fn BakeLoadModuleByKey(global: *const JSGlobalObject, key: JSValue) -> JSValue;
}

fn bake_get_on_module_namespace(
    global: &JSGlobalObject,
    module: JSValue,
    property: &[u8],
) -> Option<JSValue> {
    unsafe extern "C" {
        #[link_name = "BakeGetOnModuleNamespace"]
        fn f(global: *const JSGlobalObject, module: JSValue, ptr: *const u8, len: usize) -> JSValue;
    }
    // SAFETY: FFI call; `global` is a live &JSGlobalObject, `module` is a stack-held
    // JSValue, and `property` ptr+len are valid for the call duration.
    let result: JSValue = unsafe { f(global, module, property.as_ptr(), property.len()) };
    debug_assert!(!result.is_empty());
    Some(result)
}

/// Renders all routes for static site generation by calling the JavaScript implementation.
// TODO(port): move to bake_sys
unsafe extern "C" {
    fn BakeRenderRoutesForProdStatic(
        global: *const JSGlobalObject,
        // Output directory path (e.g., "./dist")
        out_base: BunString,
        // Server module paths (e.g., ["bake://page.js", "bake://layout.js"])
        all_server_files: JSValue,
        // Framework prerender functions by router type
        render_static: JSValue,
        // Framework getParams functions by router type
        get_params: JSValue,
        // Client entry URLs by router type (e.g., ["/client.js", null])
        client_entry_urls: JSValue,
        // Route patterns (e.g., ["/", "/about", "/blog/:slug"])
        patterns: JSValue,
        // File indices per route (e.g., [[0], [1], [2, 0]])
        files: JSValue,
        // Packed router type and flags (e.g., [0x00000000, 0x00000001])
        type_and_flags: JSValue,
        // Source paths (e.g., ["pages/index.tsx", "pages/blog/[slug].tsx"])
        src_route_files: JSValue,
        // Dynamic route params (e.g., [null, null, ["slug"]])
        param_information: JSValue,
        // CSS URLs per route (e.g., [["/main.css"], ["/main.css", "/blog.css"]])
        styles: JSValue,
    ) -> *mut JSPromise;
}

/// The result of this function is a JSValue that wont be garbage collected, as
/// it will always have at least one reference by the module loader.
fn bake_register_production_chunk(
    global: &JSGlobalObject,
    key: BunString,
    source_code: BunString,
) -> JsResult<JSValue> {
    unsafe extern "C" {
        #[link_name = "BakeRegisterProductionChunk"]
        fn f(global: *const JSGlobalObject, key: BunString, source_code: BunString) -> JSValue;
    }
    // SAFETY: FFI call; `global` is a live &JSGlobalObject; `key` and `source_code`
    // are passed by value and remain valid for the call.
    let result: JSValue = unsafe { f(global, key, source_code) };
    if result.is_empty() {
        return Err(jsc::JsError::Thrown);
    }
    debug_assert!(result.is_string());
    Ok(result)
}

#[unsafe(no_mangle)]
pub extern "C" fn BakeToWindowsPath(input: BunString) -> BunString {
    #[cfg(unix)]
    {
        let _ = input;
        panic!("This code should not be called on POSIX systems.");
    }
    #[cfg(not(unix))]
    {
        // PERF(port): was stack-fallback alloc
        // TODO(b2-blocked): bun_paths::w_path_buffer_pool, strings::to_w_path_normalize_auto_extend
        let _ = input;
        todo!("blocked_on: bun_paths::w_path_buffer_pool")
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn BakeProdResolve(
    global: *const JSGlobalObject,
    a_str: BunString,
    specifier_str: BunString,
) -> BunString {
    // PERF(port): was stack-fallback alloc (2x PathBuffer)
    // SAFETY: `global` is a non-null *const JSGlobalObject passed from C++ FFI;
    // the JSGlobalObject outlives this call.
    let _global = unsafe { &*global };
    let _ = (a_str, specifier_str);

    // TODO(b2-blocked): jsc::ModuleLoader::HardcodedModule::Alias::get + jsc::Target
    // are not yet exported from bun_jsc. The path-join below also needs the
    // `resolve_path::join_abs` borrow-lifetime story sorted (TLS buffer).
    todo!(
        "blocked_on: bun_jsc::ModuleLoader::HardcodedModule::Alias, \
         bun_jsc::Target, bun_resolver::is_package_path"
    )
}

/// After a production bundle is generated, prerendering needs to be able to
/// look up the generated chunks associated with each route's `OpaqueFileId`
/// This data structure contains that mapping, and is also used by bundle_v2
/// to enqueue the entry points.
pub struct EntryPointMap {
    pub root: Box<[u8]>,

    /// OpaqueFileId refers to the index in this map.
    /// Values are left uninitialized until after the bundle is done and indexed.
    pub files: EntryPointHashMap,

    /// Owned backing storage for the duped path bytes that `InputFile` keys
    /// point into (raw ptr+len). Mirrors Zig's `map.allocator.dupe(u8, abs_path)`
    /// against `bun.default_allocator` (.zig:889) — kept here so the allocations
    /// drop with the map instead of being `Box::leak`ed (PORTING.md §Forbidden).
    pub owned_paths: Vec<Box<[u8]>>,
}

pub type EntryPointHashMap = ArrayHashMap<InputFile, OutputFileIndex>;
// TODO(port): Zig uses a custom ArrayHashContext (hash/eql) — ensure ArrayHashMap supports custom hasher matching InputFile::ArrayHashContext

/// This approach is used instead of what DevServer does so that each
/// distinct file gets its own index.
#[derive(Clone, Copy)]
pub struct InputFile {
    pub abs_path_ptr: *const u8,
    pub abs_path_len: u32,
    pub side: bake::Side,
}

impl InputFile {
    pub fn init(abs_path: &[u8], side: bake::Side) -> InputFile {
        InputFile {
            abs_path_ptr: abs_path.as_ptr(),
            abs_path_len: u32::try_from(abs_path.len()).unwrap(),
            side,
        }
    }

    pub fn abs_path(&self) -> &[u8] {
        // SAFETY: ptr+len were constructed from a valid slice in `init`
        unsafe { core::slice::from_raw_parts(self.abs_path_ptr, self.abs_path_len as usize) }
    }
}

/// Custom hash context matching Zig's `InputFile.ArrayHashContext`.
pub struct InputFileArrayHashContext;

impl InputFileArrayHashContext {
    pub fn hash(key: &InputFile) -> u32 {
        bun_wyhash::hash32(key.abs_path()).wrapping_add(key.side as u32)
    }

    pub fn eql(a: &InputFile, b: &InputFile, _: usize) -> bool {
        a.side == b.side && a.abs_path() == b.abs_path()
    }
}

impl EntryPointMap {
    pub fn get_or_put_entry_point(
        &mut self,
        abs_path: &[u8],
        side: bake::Side,
    ) -> Result<OpaqueFileId, bun_core::Error> {
        let k = InputFile::init(abs_path, side);
        let gop = self.files.get_or_put(k)?;
        let index = gop.index;
        if !gop.found_existing {
            // Zig: `gop.key_ptr.* = InputFile.init(try map.allocator.dupe(u8, abs_path), side);`
            // The Zig `errdefer map.files.swapRemoveAt(gop.index)` only guards the
            // `allocator.dupe`, which is infallible in Rust, so no rollback guard
            // is needed. Own the duped bytes in `owned_paths` (Box heap address is
            // stable across the move) instead of `Box::leak` so they drop with the
            // map — PORTING.md §Forbidden bans `Box::leak` for `'static` borrows.
            let owned: Box<[u8]> = Box::<[u8]>::from(abs_path);
            *gop.key_ptr = InputFile::init(&owned, side);
            self.owned_paths.push(owned);
        }
        Ok(OpaqueFileId::init(u32::try_from(index).unwrap()))
    }

    pub fn get_file_id_for_router(
        &mut self,
        abs_path: &[u8],
        _: framework_router::RouteIndex,
        _: framework_router::FileKind,
    ) -> Result<OpaqueFileId, bun_core::Error> {
        self.get_or_put_entry_point(abs_path, bake::Side::Server)
    }

    pub fn on_router_collision_error(
        &mut self,
        rel_path: &[u8],
        other_id: OpaqueFileId,
        ty: framework_router::FileKind,
    ) -> Result<(), bun_alloc::AllocError> {
        bun_core::err_generic!(
            "Multiple {} matching the same route pattern is ambiguous",
            match ty {
                framework_router::FileKind::Page => "pages",
                framework_router::FileKind::Layout => "layout",
            }
        );
        bun_core::pretty_errorln!("  - <blue>{}<r>", BStr::new(rel_path));
        bun_core::pretty_errorln!(
            "  - <blue>{}<r>",
            BStr::new(resolve_path::relative(
                &self.root,
                self.files.keys()[other_id.get() as usize].abs_path()
            ))
        );
        Output::flush();
        Ok(())
    }
}

/// Data used on each rendering thread. Contains all information in the bundle needed to render.
/// This is referred to as `pt` in variable/field naming, and Bake::ProductionPerThread in C++
pub struct PerThread<'a> {
    // Shared Data
    pub input_files: &'a [InputFile],
    pub bundled_outputs: &'a [OutputFile],
    /// Indexed by entry point index (OpaqueFileId)
    pub output_indexes: &'a [OutputFileIndex],
    /// Indexed by entry point index (OpaqueFileId)
    pub module_keys: &'a [BunString],
    /// Unordered
    pub module_map: StringArrayHashMap<OutputFileIndex>,
    pub source_maps: StringArrayHashMap<OutputFileIndex>,

    // Thread-local
    pub vm: &'a VirtualMachine,
    /// Indexed by entry point index (OpaqueFileId)
    pub loaded_files: AutoBitSet,
    /// JSArray of JSString, indexed by entry point index (OpaqueFileId)
    // Zig protects/unprotects this manually; PORTING.md mandates Strong for
    // JSValue struct fields. Strong's Drop releases the GC root.
    // TODO(port): confirm bun_jsc::Strong API surface (create/get) — Phase B
    pub all_server_files: bun_jsc::Strong,
}

/// Sent to other threads for rendering
// PORT NOTE: Zig declares this as `PerThread.Options`; Rust cannot nest a struct
// inside an `impl`, so it's hoisted as a sibling type.
pub struct PerThreadOptions<'a> {
    pub input_files: &'a [InputFile],
    pub bundled_outputs: &'a [OutputFile],
    /// Indexed by entry point index (OpaqueFileId)
    pub output_indexes: &'a [OutputFileIndex],
    /// Indexed by entry point index (OpaqueFileId)
    pub module_keys: &'a [BunString],
    /// Unordered
    pub module_map: StringArrayHashMap<OutputFileIndex>,
    pub source_maps: StringArrayHashMap<OutputFileIndex>,
}

// TODO(port): move to bake_sys
unsafe extern "C" {
    fn BakeGlobalObject__attachPerThreadData(
        global: *const JSGlobalObject,
        pt: *mut PerThread<'static>,
    );
}

impl<'a> PerThread<'a> {
    /// After initializing, call `attach`
    pub fn init(vm: &'a VirtualMachine, opts: PerThreadOptions<'a>) -> Result<PerThread<'a>, bun_core::Error> {
        let loaded_files = AutoBitSet::init_empty(opts.output_indexes.len())?;
        // errdefer loaded_files.deinit() — handled by Drop on error path

        // SAFETY: vm.global is a live *mut JSGlobalObject for the VM's lifetime.
        let global = unsafe { &*vm.global };
        let all_server_files = bun_jsc::Strong::create(
            JSValue::create_empty_array(global, opts.output_indexes.len())?,
            global,
        );

        Ok(PerThread {
            input_files: opts.input_files,
            bundled_outputs: opts.bundled_outputs,
            output_indexes: opts.output_indexes,
            module_keys: opts.module_keys,
            module_map: opts.module_map,
            vm,
            loaded_files,
            all_server_files,
            source_maps: opts.source_maps,
        })
    }

    pub fn attach(&mut self) {
        unsafe {
            // SAFETY: PerThread outlives the attached lifetime; detached in Drop
            BakeGlobalObject__attachPerThreadData(
                self.vm.global,
                self as *mut PerThread<'a> as *mut PerThread<'static>,
            );
        }
    }

    pub fn output_index(&self, id: OpaqueFileId) -> OutputFileIndex {
        self.output_indexes[id.get() as usize]
    }

    pub fn input_file(&self, id: OpaqueFileId) -> InputFile {
        self.input_files[id.get() as usize]
    }

    pub fn output_file(&self, id: OpaqueFileId) -> &OutputFile {
        &self.bundled_outputs[self.output_index(id).0 as usize]
    }

    // Must be run at the top of the event loop
    pub fn load_bundled_module(&self, id: OpaqueFileId) -> Result<JSValue, bun_core::Error> {
        // SAFETY: vm.global is a live *mut JSGlobalObject for the VM's lifetime.
        let global = unsafe { &*self.vm.global };
        load_module(
            self.vm,
            global,
            self.module_keys[id.get() as usize].to_js(global)?,
        )
    }

    /// The JSString entries in `all_server_files` is generated lazily. When
    /// multiple rendering threads are used, unreferenced files will contain
    /// holes in the array used. Returns a JSValue of the "FileIndex" type
    //
    // What could be done here is generating a new index type, which is
    // specifically for referenced files. This would remove the holes, but make
    // it harder to pre-allocate. It's probably worth it.
    pub fn preload_bundled_module(&mut self, id: OpaqueFileId) -> JsResult<JSValue> {
        // SAFETY: vm.global is a live *mut JSGlobalObject for the VM's lifetime.
        let global = unsafe { &*self.vm.global };
        if !self.loaded_files.is_set(id.get() as usize) {
            self.loaded_files.set(id.get() as usize);
            self.all_server_files.get().put_index(
                global,
                u32::try_from(id.get()).unwrap(),
                self.module_keys[id.get() as usize].to_js(global)?,
            )?;
        }

        Ok(JSValue::js_number_from_int32(
            i32::try_from(id.get()).unwrap(),
        ))
    }
}

impl<'a> Drop for PerThread<'a> {
    fn drop(&mut self) {
        // SAFETY: FFI call; `self.vm.global` is still live (VM outlives PerThread),
        // and passing null detaches the previously-attached pointer.
        unsafe {
            BakeGlobalObject__attachPerThreadData(self.vm.global, core::ptr::null_mut());
        }
        // `all_server_files: Strong` is dropped automatically, releasing the GC root.
    }
}

/// Given a key, returns the source code to load.
#[unsafe(no_mangle)]
pub extern "C" fn BakeProdLoad(pt: *mut PerThread, key: BunString) -> BunString {
    // PERF(port): was stack-fallback alloc
    // SAFETY: `pt` is the non-null pointer previously attached via
    // BakeGlobalObject__attachPerThreadData; C++ only calls this while attached.
    let pt = unsafe { &*pt };
    let utf8 = key.to_utf8();
    log!("BakeProdLoad: {}\n", BStr::new(utf8.slice()));
    if let Some(value) = pt.module_map.get(utf8.slice()) {
        log!("  found in module_map: {}\n", BStr::new(utf8.slice()));
        return pt.bundled_outputs[value.0 as usize].value.to_bun_string();
    }
    BunString::dead()
}

#[unsafe(no_mangle)]
pub extern "C" fn BakeProdSourceMap(pt: *mut PerThread, key: BunString) -> BunString {
    // PERF(port): was stack-fallback alloc
    // SAFETY: `pt` is the non-null pointer previously attached via
    // BakeGlobalObject__attachPerThreadData; C++ only calls this while attached.
    let pt = unsafe { &*pt };
    let utf8 = key.to_utf8();
    if let Some(value) = pt.source_maps.get(utf8.slice()) {
        return pt.bundled_outputs[value.0 as usize].value.to_bun_string();
    }
    BunString::dead()
}

/// Packed: type (u8) | no_client (bool, 1 bit) | unused (u23)
#[repr(transparent)]
#[derive(Clone, Copy)]
pub struct TypeAndFlags(i32);

impl TypeAndFlags {
    pub const fn new(ty: u8, no_client: bool) -> Self {
        // type: bits 0..8, no_client: bit 8, unused: bits 9..32
        TypeAndFlags((ty as i32) | ((no_client as i32) << 8))
    }

    pub const fn bits(self) -> i32 {
        self.0
    }

    pub const fn r#type(self) -> u8 {
        (self.0 & 0xFF) as u8
    }

    /// Don't inclue the runtime client code (e.g.
    /// bun-framework-react/client.tsx). This is used if we know a server
    /// component does not include any downstream usages of "use client" and so
    /// we can omit the client code entirely.
    pub const fn no_client(self) -> bool {
        ((self.0 >> 8) & 1) != 0
    }
}

// `fn @"export"()` force-reference block dropped — Rust links what's `pub`.

use bun_bundler::options::EnvBehavior;
use bun_bundler::options::OutputKind;
use bun_options_types::ImportKind;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bake/production.zig (1074 lines)
//   confidence: low (phase-d: build_command/build_with_vm bodies stubbed)
//   todos:      13
//   notes:      build_command/build_with_vm/load_module/BakeProdResolve bodies are
//               todo!()-stubbed pending upstream symbol availability (see blocked_on
//               markers). PerThread<'a>, EntryPointMap, FFI externs, and the
//               BakeProdLoad/BakeProdSourceMap entry points compile against current
//               sibling crates.
// ──────────────────────────────────────────────────────────────────────────

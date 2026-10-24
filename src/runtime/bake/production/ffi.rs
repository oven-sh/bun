//! The C++ boundary of the static build: module loading and the exports C++ calls back into.

use super::*;

/// unsafe function, must be run outside of the event loop
/// fails with `JSError` on exception
pub(super) fn load_module(
    vm: *mut VirtualMachine,
    global: &JSGlobalObject,
    key: JSValue,
) -> crate::Result<JSValue> {
    let promise_value =
        jsc::from_js_host_call(global, || BakeLoadModuleByKey(global, key)).map_err(js_err)?;
    let promise: *mut jsc::JSInternalPromise = match promise_value.as_any_promise().unwrap() {
        AnyPromise::Internal(p) => p,
        AnyPromise::Normal(_) => unreachable!(),
    };
    // S012: `JSInternalPromise` (= `JSPromise`) is an `opaque_ffi!` ZST —
    // safe `*mut → &mut` deref via the const-asserted accessor.
    jsc::JSInternalPromise::opaque_mut(promise).set_handled();
    // Note: we take `*mut VirtualMachine` (not `&VirtualMachine`) so the provenance
    // permits mutation — casting a `&T` to `*mut T` and writing through it is
    // UB. The raw pointer flows from `VirtualMachine::init_bake` unchanged.
    //
    let _ = vm;
    let vm_ref = VirtualMachine::get();
    vm_ref
        .as_mut()
        .wait_for_promise(AnyPromise::Internal(promise))
        .map_err(|stopped| js_err(stopped.throw(vm_ref.global())))?;
    // TODO: Specially draining microtasks here because `waitForPromise` has a
    //       bug which forgets to do it, but I don't want to fix it right now as it
    //       could affect a lot of the codebase. This should be removed.
    if vm_ref.event_loop_mut().drain_microtasks().is_err() {
        Global::crash();
    }
    let jsc_vm = vm_ref.as_mut().jsc_vm_mut();
    match jsc::JSInternalPromise::opaque_mut(promise).unwrap(jsc_vm, UnwrapMode::MarkHandled) {
        Unwrapped::Pending => unreachable!(),
        Unwrapped::Fulfilled(_) => {
            jsc::from_js_host_call(global, || BakeGetModuleNamespace(global, key)).map_err(js_err)
        }
        Unwrapped::Rejected(err) => Err(js_err(vm_ref.global().throw_value(err))),
    }
}

// extern apis:

unsafe extern "C" {
    safe fn BakeGetDefaultExportFromModule(global: &JSGlobalObject, key: JSValue) -> JSValue;
    safe fn BakeGetModuleNamespace(global: &JSGlobalObject, key: JSValue) -> JSValue;
    safe fn BakeLoadModuleByKey(global: &JSGlobalObject, key: JSValue) -> JSValue;
}

pub(super) fn bake_get_default_export_from_module(
    global: &JSGlobalObject,
    key: JSValue,
) -> JsResult<JSValue> {
    jsc::from_js_host_call(global, || BakeGetDefaultExportFromModule(global, key))
}

pub(super) fn bake_get_on_module_namespace(
    global: &JSGlobalObject,
    module: JSValue,
    property: &[u8],
) -> JsResult<JSValue> {
    unsafe extern "C" {
        // PRECONDITION: `ptr` must be readable for `len` bytes (C++ builds an
        // `Identifier` from the slice). Cannot be `safe fn` — raw ptr+len pair
        // carries a caller-side validity precondition.
        #[link_name = "BakeGetOnModuleNamespace"]
        fn f(global: *const JSGlobalObject, module: JSValue, ptr: *const u8, len: usize)
        -> JSValue;
    }
    jsc::from_js_host_call(global, || {
        // SAFETY: `global` is a live `&JSGlobalObject`, `module` is a stack-held
        // `JSValue`, and `property.as_ptr()`/`len()` describe a valid borrowed
        // `&[u8]` for the call duration — discharges the ptr+len precondition above.
        unsafe { f(global, module, property.as_ptr(), property.len()) }
    })
}

// Renders all routes for static site generation by calling the JavaScript implementation.
// All args are by-value `JSValue` / borrowed `&BunString` plus a live `&JSGlobalObject`
// (UnsafeCell-backed); C++ allocates and returns a non-null `JSPromise*`.
// No caller-side precondition for the call itself — declare `safe fn`.
unsafe extern "C" {
    pub(super) safe fn BakeRenderRoutesForProdStatic(
        global: &JSGlobalObject,
        // Output directory path (e.g., "./dist")
        out_base: &BunString,
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

#[unsafe(no_mangle)]
extern "C" fn BakeToWindowsPath(input: &BunString) -> BunString {
    #[cfg(unix)]
    {
        let _ = input;
        panic!("This code should not be called on POSIX systems.");
    }
    #[cfg(not(unix))]
    {
        let input_utf8 = input.to_utf8();
        let input_slice = input_utf8.slice();
        let mut output = bun_paths::w_path_buffer_pool::get();
        let output_slice = strings::to_w_path_normalize_auto_extend(&mut output[..], input_slice);
        BunString::clone_utf16(output_slice.as_slice())
    }
}

#[unsafe(no_mangle)]
extern "C" fn BakeProdResolve(
    global: &JSGlobalObject,
    a_str: &BunString,
    specifier_str: &BunString,
) -> BunString {
    let specifier = specifier_str.to_utf8();

    if let Some(alias) = bun_resolve_builtins::Alias::get(
        specifier.slice(),
        bun_ast::Target::Bun,
        bun_resolve_builtins::Cfg::default(),
    ) {
        return BunString::static_(alias.path.as_bytes());
    }

    let referrer = a_str.to_utf8();

    if resolver::is_package_path(specifier.slice()) {
        let _ = global.throw(format_args!(
            "Non-relative import {} from {} are not allowed in production assets. This is a bug in Bun's bundler",
            bun_core::fmt::quote(specifier.slice()),
            bun_core::fmt::quote(referrer.slice()),
        ));
        return BunString::DEAD;
    }

    debug_assert!(strings::has_prefix(referrer.slice(), b"bake:"));

    // dirname semantics: returns None for the root / no-parent.
    let after_scheme = &referrer.slice()[5..];
    let dir = bun_paths::Dirname::dirname(after_scheme).unwrap_or(after_scheme);

    BunString::create_format(format_args!(
        "bake:{}",
        BStr::new(resolve_path::join_abs::<platform::Posix>(
            dir,
            // force posix paths in bake
            specifier.slice(),
        ))
    ))
}

/// Given a key, returns the source code to load.
#[unsafe(no_mangle)]
extern "C" fn BakeProdLoad(pt: *mut PerThread, key: &BunString) -> BunString {
    // SAFETY: `pt` is the non-null pointer previously attached via
    // BakeGlobalObject__attachPerThreadData; C++ only calls this while attached.
    let pt = unsafe { &*pt };
    let utf8 = key.to_utf8();
    log!("BakeProdLoad: {}\n", BStr::new(utf8.slice()));
    if let Some(value) = pt.module_map.get(utf8.slice()) {
        log!("  found in module_map: {}\n", BStr::new(utf8.slice()));
        // Zero-copy: alias the chunk bytes; `pt.bundled_outputs` owns them for
        // the lifetime of the attached `PerThread` (see `Value::to_bun_string_ref`).
        return pt.bundled_outputs[value.get() as usize]
            .value
            .to_bun_string_ref();
    }
    BunString::DEAD
}

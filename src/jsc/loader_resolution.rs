//! Module-specifier → loader/virtual-source resolution for the module loader.
//! Bodies moved verbatim from `bun_runtime::jsc_hooks` (which accessed the
//! same VM fields); only `blob:` ObjectURL resolution dispatches up through
//! `RuntimeHooks`.

use crate::virtual_machine::VirtualMachine;
use bun_ast::Loader;
use bun_resolver::fs as Fs;

/// `Fs.Path.loader(&jsc_vm.transpiler.options.loaders)` — re-spelt against
/// `bun_ast::LoaderHashTable` (= `StringArrayHashMap<bun_ast::Loader>`).
pub(crate) fn loader_for_path(
    path: &Fs::Path<'_>,
    loaders: &bun_ast::LoaderHashTable,
) -> Option<Loader> {
    if path.is_data_url() {
        return Some(Loader::Dataurl);
    }
    let name = path.name();
    let ext = name.ext;
    let result = loaders
        .get(ext)
        .copied()
        .or_else(|| Loader::from_string(ext));
    if result.is_none() || result == Some(Loader::Json) {
        let str = name.filename;
        if str == b"package.json" || str == b"bun.lock" {
            return Some(Loader::Jsonc);
        }
        if str.ends_with(b".jsonc") {
            return Some(Loader::Jsonc);
        }
        if (str.starts_with(b"tsconfig.") || str.starts_with(b"jsconfig."))
            && str.ends_with(b".json")
        {
            return Some(Loader::Jsonc);
        }
    }
    result
}

/// `options.normalizeSpecifier(jsc_vm, slice)` — strip the VM's origin
/// host/path prefix and split off the `?query`.
///
/// # Safety
/// `jsc_vm` is the live per-thread VM.
pub unsafe fn normalize_specifier_for_loader<'a>(
    jsc_vm: *mut VirtualMachine,
    slice_: &'a [u8],
) -> (&'a [u8], &'a [u8], &'a [u8]) {
    let mut slice = slice_;
    if slice.is_empty() {
        return (slice, slice, b"");
    }
    // SAFETY: per fn contract — `jsc_vm` is the live per-thread VM.
    let host = unsafe { &*jsc_vm }.origin.host;
    // SAFETY: per fn contract — `jsc_vm` is the live per-thread VM.
    let opath = unsafe { &*jsc_vm }.origin.path;
    if slice.starts_with(host) {
        slice = &slice[host.len()..];
    }
    if opath.len() > 1 && slice.starts_with(opath) {
        slice = &slice[opath.len()..];
    }
    let specifier = slice;
    let mut query: &[u8] = b"";
    if let Some(i) = bun_core::strings::index_of_char_usize(slice, b'?') {
        let i = i as usize;
        query = &slice[i..];
        slice = &slice[..i];
    }
    (slice, specifier, query)
}

/// Result of [`get_loader_and_virtual_source`] — mirrors
/// `options.LoaderResult`.
pub struct LoaderResult<'a> {
    pub loader: Option<Loader>,
    pub virtual_source: Option<&'a bun_ast::Source>,
    pub path: Fs::Path<'a>,
    pub is_main: bool,
    pub specifier: &'a [u8],
    /// Always `None` for non-JS-like loaders (not needed there).
    pub package_json: Option<&'a bun_resolver::package_json::PackageJSON>,
}

/// `options.getLoaderAndVirtualSource` — high-tier body. Takes the
/// `*mut VirtualMachine` directly.
///
/// # Safety
/// `jsc_vm` is the live per-thread VM; the returned borrows live as long as
/// the input `specifier_str` / the VM's resolver caches.
pub unsafe fn get_loader_and_virtual_source<'a>(
    specifier_str: &'a [u8],
    jsc_vm: *mut VirtualMachine,
    virtual_source_to_use: &'a mut Option<bun_ast::Source>,
    blob_to_deinit: &mut Option<crate::webcore_types::Blob>,
    type_attribute_str: Option<&[u8]>,
) -> Result<LoaderResult<'a>, bun_core::Error> {
    let (normalized_file_path_from_specifier, specifier, query) =
        // SAFETY: per fn contract.
        unsafe { normalize_specifier_for_loader(jsc_vm, specifier_str) };
    let mut path = Fs::Path::init(normalized_file_path_from_specifier);

    // SAFETY: per fn contract — `transpiler.options` is a value field of the VM.
    let mut loader: Option<Loader> =
        loader_for_path(&path, unsafe { &(*jsc_vm).transpiler.options.loaders });
    let mut virtual_source: Option<&'a bun_ast::Source> = None;

    // Synthetic `[eval]`/`[stdin]` source.
    // SAFETY: per fn contract.
    if let Some(eval_source) = unsafe { &*jsc_vm }.module_loader.eval_source.as_deref() {
        // Note: the suffix is `\\[eval]` on Windows; the
        // separator-agnostic `Path::sep_any()` check matches both.
        const EVAL: &[u8] = b"[eval]";
        const STDIN: &[u8] = b"[stdin]";
        let is_eval = specifier.len() > EVAL.len()
            && specifier.ends_with(EVAL)
            && bun_paths::resolve_path::is_sep_any(specifier[specifier.len() - EVAL.len() - 1]);
        let is_stdin = specifier.len() > STDIN.len()
            && specifier.ends_with(STDIN)
            && bun_paths::resolve_path::is_sep_any(specifier[specifier.len() - STDIN.len() - 1]);
        if is_eval || is_stdin {
            // SAFETY: `eval_source` is heap-owned by the VM (`Box<Source>`); it
            // outlives the synchronous transpile this borrow feeds into.
            virtual_source = Some(unsafe { &*std::ptr::from_ref::<bun_ast::Source>(eval_source) });
            loader = Some(Loader::Tsx);
        }
    }

    // `blob:` ObjectURL → in-memory virtual source. The loader sniff lives in
    // `bun_runtime::webcore`; dispatched through RuntimeHooks (cold).
    // SAFETY: hook contract — `jsc_vm` is the live per-thread VM.
    match unsafe {
        (crate::virtual_machine::runtime_hooks().resolve_blob_url_for_loader)(specifier, jsc_vm)
    } {
        Ok(None) => {}
        Err(()) => return Err(bun_core::err!("BlobNotFound")),
        Ok(Some((b, blob_loader))) => {
            *blob_to_deinit = Some(b);
            // SAFETY: `blob_to_deinit` is `Some` (just written); we hold
            // `&mut` for the duration of this body, so `as_mut().unwrap()`
            // is sound and the `&'a` reborrow points at storage owned by
            // the *caller's* `Option<Blob>` slot (outlives `LoaderResult`).
            let blob = blob_to_deinit.as_mut().unwrap();
            loader = blob_loader;

            // "file:" loader makes no sense for blobs, so default to tsx.
            if let Some(filename) = blob.get_file_name() {
                // Only treat it as a file if it is a `Bun.file()`.
                if blob.needs_to_read_file() {
                    // Note: borrowck — `Fs::Path<'a>` borrows
                    // `filename`, which borrows `*blob_to_deinit`. The
                    // caller owns that slot for `'a`, so erase via raw ptr.
                    // SAFETY: `filename` borrows the blob's backing store,
                    // which the caller's `blob_to_deinit` slot keeps alive
                    // for `'a`; reconstructing the slice preserves provenance.
                    path = Fs::Path::init(unsafe {
                        core::slice::from_raw_parts(filename.as_ptr(), filename.len())
                    });
                }
            }

            if !blob.needs_to_read_file() {
                // SAFETY: same lifetime erasure as above — `shared_view()`
                // borrows the blob's backing store (held in the caller's
                // `blob_to_deinit` slot for the synchronous transpile).
                // `bun_ast::Source` stores `&'static [u8]` (see
                // logger/lib.rs §`type Str`), so erase to
                // `'static`; sound because the blob outlives the
                // synchronous `transpile_source_code_inner` call.
                let (contents, path_text): (&'static [u8], &'static [u8]) = unsafe {
                    let v = blob.shared_view();
                    (
                        core::slice::from_raw_parts(v.as_ptr(), v.len()),
                        core::slice::from_raw_parts(path.text.as_ptr(), path.text.len()),
                    )
                };
                *virtual_source_to_use = Some(bun_ast::Source {
                    // Note: `bun_ast::Source::path` is the
                    // logger-local `fs::Path` (NOT `bun_resolver::fs::Path`
                    // — see logger/lib.rs:32-). Re-init from `path.text`.
                    path: bun_paths::fs::Path::init(path_text),
                    contents: bun_ptr::Cow::Borrowed(contents),
                    ..Default::default()
                });
                virtual_source = virtual_source_to_use.as_ref();
            }
        }
    }

    if query == b"?raw" {
        loader = Some(Loader::Text);
    }
    if let Some(attr_str) = type_attribute_str {
        if let Some(attr_loader) = Loader::from_string(attr_str) {
            loader = Some(attr_loader);
        }
    }

    // SAFETY: per fn contract.
    let is_main = specifier == unsafe { &*jsc_vm }.main();

    // package.json sniff for `.js`/`.ts` module-type.
    let dir = path.name().dir;
    let is_js_like = loader.map(|l| l.is_java_script_like()).unwrap_or(true);
    let package_json = if is_js_like && bun_paths::is_absolute(dir) {
        // SAFETY: per fn contract — `transpiler.resolver` is a value field of
        // the VM; `read_dir_info` is re-entrant on the JS thread.
        match unsafe { (*jsc_vm).transpiler.resolver.read_dir_info(dir) } {
            Ok(Some(dir_info)) => dir_info.package_json().or(dir_info.enclosing_package_json),
            _ => None,
        }
    } else {
        None
    };

    Ok(LoaderResult {
        loader,
        virtual_source,
        path,
        is_main,
        specifier,
        package_json,
    })
}

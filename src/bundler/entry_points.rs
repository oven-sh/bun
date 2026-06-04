use std::io::Write as _;

use bstr::BStr;

use bun_core::fmt as bun_fmt;
use bun_core::strings;
use bun_wyhash::{self, Wyhash11};

use crate::Transpiler;
use bun_js_parser as js_ast;

// `Path`/`PathName` come from the lower-tier `bun_paths::fs` shim
// (lifetime-erased `'static` slices) so `bun_ast::Source` field types line up;
// `FileSystem` is the real `bun_resolver::fs` singleton now that
// `bun_resolver` is in this crate's dep set.
pub mod Fs {
    pub use bun_paths::fs::{Path, PathName};
    pub use bun_resolver::fs::FileSystem;
}

pub struct FallbackEntryPoint {
    /// The generated code is owned by `source.contents` (`Cow::Owned`), so the
    /// entry is not self-referential and may move freely.
    pub source: bun_ast::Source,
    // Only ever assigned the literal "" (no writer anywhere in the tree); never freed.
    pub built_code: &'static [u8],
}

impl Default for FallbackEntryPoint {
    fn default() -> Self {
        Self {
            source: bun_ast::Source::default(),
            built_code: b"",
        }
    }
}

impl FallbackEntryPoint {
    pub fn generate<TranspilerType>(
        entry: &mut FallbackEntryPoint,
        input_path: &[u8],
        transpiler: &mut TranspilerType,
    ) -> Result<(), bun_core::Error>
    where
        TranspilerType: TranspilerLike,
    {
        // This is *extremely* naive.
        // The basic idea here is this:
        // --
        // import * as EntryPoint from 'entry-point';
        // import boot from 'framework';
        // boot(EntryPoint);
        // --
        // We go through the steps of printing the code -- only to then parse/transpile it because
        // we want it to go through the linker and the rest of the transpilation process

        let disable_css_imports = transpiler
            .options()
            .framework
            .as_ref()
            .unwrap()
            .client_css_in_js
            != ClientCssInJs::AutoOnImportCss;

        // assemble bytes directly (not `write!`+`BStr`) so a
        // non-UTF-8 byte in `input_path` is emitted verbatim,
        // not lossily replaced with U+FFFD by `BStr as Display`.
        let (prefix, suffix): (&[u8], &[u8]) = if disable_css_imports {
            (
                b"globalThis.Bun_disableCSSImports = true;\nimport boot from '",
                b"';\nboot(globalThis.__BUN_DATA__);",
            )
        } else {
            (b"import boot from '", b"';\nboot(globalThis.__BUN_DATA__);")
        };
        // The Source owns the rendered bytes (`Cow::Owned`), so nothing in
        // `entry` is borrowed and the entry may move or be cloned-from freely.
        // The path borrows the caller's `input_path` (lifetime-erased by
        // `IntoStr`), same contract as before.
        let mut code: Vec<u8> = Vec::with_capacity(prefix.len() + input_path.len() + suffix.len());
        code.extend_from_slice(prefix);
        code.extend_from_slice(input_path);
        code.extend_from_slice(suffix);
        entry.source = bun_ast::Source::init_path_string_owned(input_path, code);

        entry.source.path.namespace = b"fallback-entry";
        Ok(())
    }
}

pub struct ClientEntryPoint {
    /// Heap backing for `source.path.text`. Boxed so the path bytes stay at a
    /// stable address when the entry itself moves (the old inline
    /// `path_buffer` made the entry self-referential and unmovable while
    /// `source` was in use). Written exactly once: `generate` debug-asserts
    /// the box is still empty, because replacing it would free the previous
    /// allocation under any `Source` cloned from `source` (the clone
    /// deep-copies the owned contents but copies the borrowed path). The
    /// entry must also not be dropped while such a clone is alive.
    path_storage: Box<[u8]>,
    pub source: bun_ast::Source,
}

impl Default for ClientEntryPoint {
    fn default() -> Self {
        Self {
            path_storage: Box::default(),
            source: bun_ast::Source::default(),
        }
    }
}

impl ClientEntryPoint {
    pub fn is_entry_point_path(extname: &[u8]) -> bool {
        strings::starts_with(b"entry.", extname)
    }

    // takes the lifetime-generic `bun_paths::fs::PathName<'_>` (not the
    // `'static`-field `bun_paths::fs::PathName<'static>`) so callers with a borrowed path
    // (e.g. `bun_runtime::filesystem_router::get_script_src_string`) needn't forge
    // `'static`. The body only copies `dir`/`base`/`ext` into `outbuffer`.
    pub fn generate_entry_point_path<'a>(
        outbuffer: &'a mut [u8],
        original_path: &bun_paths::fs::PathName<'_>,
    ) -> &'a [u8] {
        let joined_base_and_dir_parts: [&[u8]; 2] = [original_path.dir, original_path.base];
        // SAFETY: FileSystem singleton is initialized before bundling.
        let mut generated_path =
            Fs::FileSystem::get().abs_buf(&joined_base_and_dir_parts, outbuffer);

        // reshaped for borrowck — capture len, drop borrow, re-borrow outbuffer.
        let mut len = generated_path.len();
        outbuffer[len..len + b".entry".len()].copy_from_slice(b".entry");
        len += b".entry".len();
        generated_path = &outbuffer[..len];
        let _ = generated_path;
        outbuffer[len..len + original_path.ext.len()].copy_from_slice(original_path.ext);
        &outbuffer[..len + original_path.ext.len()]
    }

    pub fn decode_entry_point_path<'a>(
        outbuffer: &'a mut [u8],
        original_path: &Fs::PathName,
    ) -> &'a [u8] {
        let joined_base_and_dir_parts: [&[u8]; 2] = [original_path.dir, original_path.base];
        // SAFETY: FileSystem singleton is initialized before bundling.
        let generated_path = Fs::FileSystem::get().abs_buf(&joined_base_and_dir_parts, outbuffer);
        let len = generated_path.len();
        let mut original_ext = original_path.ext;
        if let Some(entry_i) = strings::index_of(original_path.ext, b"entry") {
            original_ext = &original_path.ext[entry_i + b"entry".len()..];
        }

        outbuffer[len..len + original_ext.len()].copy_from_slice(original_ext);

        &outbuffer[..len + original_ext.len()]
    }

    pub fn generate<TranspilerType>(
        &mut self,
        transpiler: &mut TranspilerType,
        original_path: &Fs::PathName,
        client: &[u8],
    ) -> Result<(), bun_core::Error>
    where
        TranspilerType: TranspilerLike,
    {
        let entry = self;
        // Single-generation invariant: regenerating would free the previous
        // `path_storage` box while a `Source` cloned from an earlier
        // `generate` may still borrow its path text (see field doc).
        debug_assert!(
            entry.path_storage.is_empty(),
            "ClientEntryPoint::generate called twice on the same entry"
        );
        // This is *extremely* naive.
        // The basic idea here is this:
        // --
        // import * as EntryPoint from 'entry-point';
        // import boot from 'framework';
        // boot(EntryPoint);
        // --
        // We go through the steps of printing the code -- only to then parse/transpile it because
        // we want it to go through the linker and the rest of the transpilation process

        let dir_to_use: &[u8] = original_path.dir_with_trailing_slash();
        let disable_css_imports = transpiler
            .options()
            .framework
            .as_ref()
            .unwrap()
            .client_css_in_js
            != ClientCssInJs::AutoOnImportCss;

        // The generated code is owned by the `Source` (`Cow::Owned`), so a
        // clone of `entry.source` carries its own copy of the contents.
        let mut code: Vec<u8> = Vec::new();
        if disable_css_imports {
            write!(
                &mut code,
                "globalThis.Bun_disableCSSImports = true;\n\
                 import boot from '{}';\n\
                 import * as EntryPoint from '{}{}';\n\
                 boot(EntryPoint);",
                BStr::new(client),
                BStr::new(dir_to_use),
                BStr::new(original_path.filename),
            )
            .map_err(|_| bun_core::err!("FormatError"))?;
        } else {
            write!(
                &mut code,
                "import boot from '{}';\n\
                 if ('setLoaded' in boot) boot.setLoaded(loaded);\n\
                 import * as EntryPoint from '{}{}';\n\
                 boot(EntryPoint);",
                BStr::new(client),
                BStr::new(dir_to_use),
                BStr::new(original_path.filename),
            )
            .map_err(|_| bun_core::err!("FormatError"))?;
        }

        // `bun_paths::fs::PathName<'static>` → `bun_paths::fs::PathName<'static>`: field-identical
        // mirrors (see `#[repr(C)]` note on both); spell out the copy instead of a cast.
        let original_path_borrowed = bun_paths::fs::PathName {
            dir: original_path.dir,
            base: original_path.base,
            ext: original_path.ext,
            filename: original_path.filename,
        };
        // Render the synthetic entry path into pooled scratch, then copy it
        // into the entry-owned heap box so `source.path` borrows storage that
        // is address-stable across moves of the entry (see field doc).
        let mut scratch = bun_paths::path_buffer_pool::get();
        let generated_path =
            Self::generate_entry_point_path(scratch.as_mut_slice(), &original_path_borrowed);
        entry.path_storage = generated_path.to_vec().into_boxed_slice();
        drop(scratch);
        entry.source = bun_ast::Source::init_path_string_owned(&*entry.path_storage, code);
        entry.source.path.namespace = b"client-entry";
        Ok(())
    }
}

#[derive(Default)]
pub struct ServerEntryPoint {
    /// The generated wrapper source for `bun:main`. Always a valid slice
    /// (either empty or owned by `bun.default_allocator`) so readers never
    /// see `undefined` memory regardless of the `generated` flag's state.
    pub contents: Box<[u8]>,
    pub generated: bool,
}

// `deinit` only freed `contents` and reset flags; with `Box<[u8]>` this is the
// auto-generated `Drop`, so no explicit impl is needed.

impl ServerEntryPoint {
    pub fn generate(
        entry: &mut ServerEntryPoint,
        is_hot_reload_enabled: bool,
        path_to_use: &[u8],
    ) -> Result<(), bun_core::Error> {
        // Use the global arena so this buffer's lifetime is decoupled
        // from whichever arena the caller's VM happens to be using; the
        // slice is read later from `getHardcodedModule` which outlives any
        // per-transpile arena.
        let code: Vec<u8> = 'brk: {
            if is_hot_reload_enabled {
                let mut v: Vec<u8> = Vec::new();
                write!(
                    &mut v,
                    "// @bun\n\
                     import * as start from '{}';\n\
                     var hmrSymbol = Symbol(\"BunServerHMR\");\n\
                     var entryNamespace = start;\n\
                     function isServerConfig(def) {{\n\
                     \x20  return def && def !== globalThis && (typeof def.fetch === 'function' || def.app != undefined) && typeof def.stop !== 'function';\n\
                     }}\n\
                     if (typeof entryNamespace?.then === 'function') {{\n\
                     \x20  entryNamespace = entryNamespace.then((entryNamespace) => {{\n\
                     \x20     var def = entryNamespace?.default;\n\
                     \x20     if (isServerConfig(def))  {{\n\
                     \x20       var server = globalThis[hmrSymbol];\n\
                     \x20       if (server) {{\n\
                     \x20          server.reload(def);\n\
                     \x20          console.debug(`Reloaded ${{server.development ? 'development ' : ''}}server: ${{server.protocol}}://${{server.hostname}}:${{server.port}}`);\n\
                     \x20       }} else {{\n\
                     \x20          server = globalThis[hmrSymbol] = Bun.serve(def);\n\
                     \x20          console.debug(`Started ${{server.development ? 'development ' : ''}}server: ${{server.protocol}}://${{server.hostname}}:${{server.port}}`);\n\
                     \x20       }}\n\
                     \x20     }}\n\
                     \x20  }}, reportError);\n\
                     }} else if (isServerConfig(entryNamespace?.default)) {{\n\
                     \x20  var server = globalThis[hmrSymbol];\n\
                     \x20  if (server) {{\n\
                     \x20     server.reload(entryNamespace.default);\n\
                     \x20     console.debug(`Reloaded ${{server.development ? 'development ' : ''}}server: ${{server.protocol}}://${{server.hostname}}:${{server.port}}`);\n\
                     \x20  }} else {{\n\
                     \x20     server = globalThis[hmrSymbol] = Bun.serve(entryNamespace.default);\n\
                     \x20     console.debug(`Started ${{server.development ? 'development ' : ''}}server: ${{server.protocol}}://${{server.hostname}}:${{server.port}}`);\n\
                     \x20  }}\n\
                     }}\n",
                    strings::format_escapes(path_to_use, strings::QuoteEscapeFormatFlags { quote_char: b'\'', ..Default::default() }),
                )
                .map_err(|_| bun_core::err!("FormatError"))?;
                break 'brk v;
            }
            let mut v: Vec<u8> = Vec::new();
            write!(
                &mut v,
                "// @bun\n\
                 import * as start from \"{}\";\n\
                 var entryNamespace = start;\n\
                 function isServerConfig(def) {{\n\
                 \x20  return def && def !== globalThis && (typeof def.fetch === 'function' || def.app != undefined) && typeof def.stop !== 'function';\n\
                 }}\n\
                 if (typeof entryNamespace?.then === 'function') {{\n\
                 \x20  entryNamespace = entryNamespace.then((entryNamespace) => {{\n\
                 \x20     if (isServerConfig(entryNamespace?.default))  {{\n\
                 \x20       const server = Bun.serve(entryNamespace.default);\n\
                 \x20       console.debug(`Started ${{server.development ? 'development ' : ''}}server: ${{server.protocol}}://${{server.hostname}}:${{server.port}}`);\n\
                 \x20     }}\n\
                 \x20  }}, reportError);\n\
                 }} else if (isServerConfig(entryNamespace?.default)) {{\n\
                 \x20  const server = Bun.serve(entryNamespace.default);\n\
                 \x20  console.debug(`Started ${{server.development ? 'development ' : ''}}server: ${{server.protocol}}://${{server.hostname}}:${{server.port}}`);\n\
                 }}\n",
                strings::format_escapes(path_to_use, strings::QuoteEscapeFormatFlags { quote_char: b'"', ..Default::default() }),
            )
            .map_err(|_| bun_core::err!("FormatError"))?;
            v
        };

        // Free the previous buffer on regenerate (hot reload) instead of
        // leaking it. `contents` is either "" or a previously generated buffer.
        // (Handled implicitly: assigning to `Box<[u8]>` drops the old one.)
        entry.contents = code.into_boxed_slice();
        entry.generated = true;
        Ok(())
    }
}

// This is not very fast. The idea is: we want to generate a unique entry point
// per macro function export that registers the macro Registering the macro
// happens in VirtualMachine We "register" it which just marks the JSValue as
// protected. This is mostly a workaround for being unable to call ESM exported
// functions from C++. When that is resolved, we should remove this.
pub struct MacroEntryPoint {
    /// Heap backing for `source.path.text` (the macro label / specifier).
    /// Boxed so the bytes are address-stable when the entry moves; the
    /// generated code itself is owned by `source.contents` (`Cow::Owned`).
    /// Entries are cached in `VirtualMachine.macro_entry_points` for the VM
    /// lifetime, so the box (and the path borrowing it) is never freed while
    /// readers exist. (The old inline `code_buffer`/`output_code_buffer`
    /// made the entry self-referential — and 66 KB — for no benefit.)
    label_storage: Box<[u8]>,
    pub source: bun_ast::Source,
}

impl Default for MacroEntryPoint {
    fn default() -> Self {
        Self {
            label_storage: Box::default(),
            source: bun_ast::Source::default(),
        }
    }
}

impl MacroEntryPoint {
    pub fn generate_id(
        entry_path: &[u8],
        function_name: &[u8],
        buf: &mut [u8],
        len: &mut u32,
    ) -> i32 {
        let mut hasher = Wyhash11::init(0);
        hasher.update(js_ast::Macro::NAMESPACE_WITH_COLON);
        hasher.update(entry_path);
        hasher.update(function_name);
        let hash = hasher.final_();
        let fmt = bun_fmt::hex_int_lower::<16>(hash);

        // reshaped for borrowck — capture cursor position, drop &mut
        // borrow, then re-borrow `buf` immutably.
        let n = {
            let mut cursor = std::io::Cursor::new(&mut buf[..]);
            write!(
                &mut cursor,
                concat!("{}", "//{}.js"),
                BStr::new(js_ast::Macro::NAMESPACE_WITH_COLON),
                fmt,
            )
            .expect("unreachable");
            cursor.position() as usize
        };
        let specifier: &[u8] = &buf[..n];
        *len = specifier.len() as u32;

        Self::generate_id_from_specifier(specifier)
    }

    pub fn generate_id_from_specifier(specifier: &[u8]) -> i32 {
        // Same-size bitcast u32 → i32.
        (bun_wyhash::hash(specifier) as u32) as i32
    }

    pub fn generate(
        entry: &mut MacroEntryPoint,
        _: &mut Transpiler,
        import_path: &Fs::PathName,
        function_name: &[u8],
        macro_id: i32,
        macro_label_: &[u8],
    ) -> Result<(), bun_core::Error> {
        // Single-generation invariant: entries are generated once per cache
        // slot (`VirtualMachine.macro_entry_points` vacant arm); regenerating
        // would free the previous `label_storage` box under the path borrow
        // held by `source`.
        debug_assert!(
            entry.label_storage.is_empty(),
            "MacroEntryPoint::generate called twice on the same entry"
        );
        let dir_to_use: &[u8] = if import_path.dir.is_empty() {
            b""
        } else {
            import_path.dir_with_trailing_slash()
        };

        let mut code: Vec<u8> = Vec::new();
        'brk: {
            if import_path.base == b"bun" {
                write!(
                    &mut code,
                    "//Auto-generated file\n\
                     var Macros;\n\
                     try {{\n\
                     \x20 Macros = globalThis.Bun;\n\
                     }} catch (err) {{\n\
                     \x20  console.error(\"Error importing macro\");\n\
                     \x20  throw err;\n\
                     }}\n\
                     const macro = Macros['{}'];\n\
                     if (!macro) {{\n\
                     \x20 throw new Error(\"Macro '{}' not found in 'bun'\");\n\
                     }}\n\
                     \n\
                     Bun.registerMacro({}, macro);",
                    BStr::new(function_name),
                    BStr::new(function_name),
                    macro_id,
                )
                .map_err(|_| bun_core::err!("FormatError"))?;
                break 'brk;
            }

            write!(
                &mut code,
                "//Auto-generated file\n\
                 var Macros;\n\
                 try {{\n\
                 \x20 Macros = await import('{}{}');\n\
                 }} catch (err) {{\n\
                 \x20  console.error(\"Error importing macro\");\n\
                 \x20  throw err;\n\
                 }}\n\
                 if (!('{}' in Macros)) {{\n\
                 \x20 throw new Error(\"Macro '{}' not found in '{}{}'\");\n\
                 }}\n\
                 \n\
                 Bun.registerMacro({}, Macros['{}']);",
                bun_fmt::fmt_path_u8(
                    dir_to_use,
                    bun_fmt::PathFormatOptions {
                        escape_backslashes: true,
                        ..Default::default()
                    }
                ),
                bun_fmt::fmt_path_u8(
                    import_path.filename,
                    bun_fmt::PathFormatOptions {
                        escape_backslashes: true,
                        ..Default::default()
                    }
                ),
                BStr::new(function_name),
                BStr::new(function_name),
                bun_fmt::fmt_path_u8(
                    dir_to_use,
                    bun_fmt::PathFormatOptions {
                        escape_backslashes: true,
                        ..Default::default()
                    }
                ),
                bun_fmt::fmt_path_u8(
                    import_path.filename,
                    bun_fmt::PathFormatOptions {
                        escape_backslashes: true,
                        ..Default::default()
                    }
                ),
                macro_id,
                BStr::new(function_name),
            )
            .map_err(|_| bun_core::err!("FormatError"))?;
        }

        // The label backs `source.path.text`: copy it into the entry-owned
        // heap box (address-stable across moves of the entry; see field doc),
        // and let the `Source` own the generated code outright. The entry is
        // heap-pinned in `VirtualMachine.macro_entry_points` for the VM
        // lifetime, so the path borrow never outlives its backing.
        entry.label_storage = macro_label_.to_vec().into_boxed_slice();
        entry.source = bun_ast::Source::init_path_string_owned(&*entry.label_storage, code);
        // `Path::init` already set `text = macro_label`; only override namespace.
        entry.source.path.namespace = js_ast::Macro::NAMESPACE;
        Ok(())
    }
}

// Trait abstraction over the transpiler types used by
// FallbackEntryPoint/ClientEntryPoint.
pub trait TranspilerLike {
    fn options(&self) -> &crate::options::Options<'_>;
}

use crate::options::ClientCssInJs;

use std::io::Write as _;

use bstr::BStr;

use bun_core::fmt as bun_fmt;
use bun_logger as logger;
use bun_paths::{self, PathBuffer, MAX_PATH_BYTES};
use bun_fs as Fs;
use bun_str::strings;
use bun_wyhash::{self, Wyhash11};

use crate::Transpiler;
use bun_js_parser as js_ast;

pub struct FallbackEntryPoint {
    pub code_buffer: [u8; 8192],
    pub path_buffer: PathBuffer,
    pub source: logger::Source,
    // Only ever assigned the literal "" (no writer anywhere in the tree); never freed.
    pub built_code: &'static [u8],
}

impl Default for FallbackEntryPoint {
    fn default() -> Self {
        Self {
            code_buffer: [0u8; 8192],
            path_buffer: PathBuffer::uninit(),
            source: logger::Source::default(),
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
    // TODO(port): narrow error set
    where
        // TODO(port): TranspilerType trait bound — body reads `.options.framework` and `.allocator`.
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

        // TODO(port): self-referential — `code` borrows `entry.code_buffer` (or a heap alloc) and
        // is then stored into `entry.source`. Phase B: store as raw `*const [u8]` inside Source or
        // restructure so Source owns its bytes.
        let code: &[u8];

        if disable_css_imports {
            // Zig fmt placeholders: {s} → bytes
            macro_rules! write_fmt {
                ($w:expr) => {
                    write!(
                        $w,
                        "globalThis.Bun_disableCSSImports = true;\n\
                         import boot from '{}';\n\
                         boot(globalThis.__BUN_DATA__);",
                        BStr::new(input_path),
                    )
                };
            }

            // PERF(port): was std.fmt.count + bufPrint/allocPrint stack-fallback — profile in Phase B
            let mut cursor = std::io::Cursor::new(&mut entry.code_buffer[..]);
            if write_fmt!(&mut cursor).is_ok() {
                let n = cursor.position() as usize;
                code = &entry.code_buffer[..n];
            } else {
                let mut v: Vec<u8> = Vec::new();
                write_fmt!(&mut v).map_err(|_| bun_core::err!("FormatError"))?;
                // TODO(port): heap-allocated branch leaks (matches Zig: transpiler.allocator owns it).
                code = Box::leak(v.into_boxed_slice());
            }
        } else {
            macro_rules! write_fmt {
                ($w:expr) => {
                    write!(
                        $w,
                        "import boot from '{}';\n\
                         boot(globalThis.__BUN_DATA__);",
                        BStr::new(input_path),
                    )
                };
            }

            let mut cursor = std::io::Cursor::new(&mut entry.code_buffer[..]);
            if write_fmt!(&mut cursor).is_ok() {
                let n = cursor.position() as usize;
                code = &entry.code_buffer[..n];
            } else {
                let mut v: Vec<u8> = Vec::new();
                write_fmt!(&mut v).map_err(|_| bun_core::err!("FormatError"))?;
                code = Box::leak(v.into_boxed_slice());
            }
        }

        entry.source = logger::Source::init_path_string(input_path, code);
        entry.source.path.namespace = b"fallback-entry";
        Ok(())
    }
}

pub struct ClientEntryPoint {
    pub code_buffer: [u8; 8192],
    pub path_buffer: PathBuffer,
    pub source: logger::Source,
}

impl Default for ClientEntryPoint {
    fn default() -> Self {
        Self {
            code_buffer: [0u8; 8192],
            path_buffer: PathBuffer::uninit(),
            source: logger::Source::default(),
        }
    }
}

impl ClientEntryPoint {
    pub fn is_entry_point_path(extname: &[u8]) -> bool {
        strings::starts_with(b"entry.", extname)
    }

    pub fn generate_entry_point_path<'a>(
        outbuffer: &'a mut [u8],
        original_path: &Fs::PathName,
    ) -> &'a [u8] {
        let joined_base_and_dir_parts: [&[u8]; 2] = [original_path.dir, original_path.base];
        let mut generated_path =
            Fs::FileSystem::instance().abs_buf(&joined_base_and_dir_parts, outbuffer);

        // PORT NOTE: reshaped for borrowck — capture len, drop borrow, re-borrow outbuffer.
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
        let generated_path =
            Fs::FileSystem::instance().abs_buf(&joined_base_and_dir_parts, outbuffer);
        let len = generated_path.len();
        let mut original_ext = original_path.ext;
        if let Some(entry_i) = strings::index_of(original_path.ext, b"entry") {
            original_ext = &original_path.ext[entry_i + b"entry".len()..];
        }

        outbuffer[len..len + original_ext.len()].copy_from_slice(original_ext);

        &outbuffer[..len + original_ext.len()]
    }

    pub fn generate<TranspilerType>(
        entry: &mut ClientEntryPoint,
        transpiler: &mut TranspilerType,
        original_path: &Fs::PathName,
        client: &[u8],
    ) -> Result<(), bun_core::Error>
    // TODO(port): narrow error set
    where
        // TODO(port): TranspilerType trait bound — body reads `.options.framework`.
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

        let dir_to_use: &[u8] = original_path.dir_with_trailing_slash();
        let disable_css_imports = transpiler
            .options()
            .framework
            .as_ref()
            .unwrap()
            .client_css_in_js
            != ClientCssInJs::AutoOnImportCss;

        // TODO(port): self-referential — `code` borrows `entry.code_buffer` and is stored into
        // `entry.source`. See note in FallbackEntryPoint::generate.
        let code: &[u8];

        if disable_css_imports {
            let mut cursor = std::io::Cursor::new(&mut entry.code_buffer[..]);
            write!(
                &mut cursor,
                "globalThis.Bun_disableCSSImports = true;\n\
                 import boot from '{}';\n\
                 import * as EntryPoint from '{}{}';\n\
                 boot(EntryPoint);",
                BStr::new(client),
                BStr::new(dir_to_use),
                BStr::new(original_path.filename),
            )
            .map_err(|_| bun_core::err!("NoSpaceLeft"))?;
            let n = cursor.position() as usize;
            code = &entry.code_buffer[..n];
        } else {
            let mut cursor = std::io::Cursor::new(&mut entry.code_buffer[..]);
            write!(
                &mut cursor,
                "import boot from '{}';\n\
                 if ('setLoaded' in boot) boot.setLoaded(loaded);\n\
                 import * as EntryPoint from '{}{}';\n\
                 boot(EntryPoint);",
                BStr::new(client),
                BStr::new(dir_to_use),
                BStr::new(original_path.filename),
            )
            .map_err(|_| bun_core::err!("NoSpaceLeft"))?;
            let n = cursor.position() as usize;
            code = &entry.code_buffer[..n];
        }

        entry.source = logger::Source::init_path_string(
            Self::generate_entry_point_path(entry.path_buffer.as_mut_slice(), original_path),
            code,
        );
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
        // TODO(port): narrow error set
        // Use the global allocator so this buffer's lifetime is decoupled
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
                    strings::format_escapes(path_to_use, strings::FormatEscapesOptions { quote_char: b'\'' }),
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
                strings::format_escapes(path_to_use, strings::FormatEscapesOptions { quote_char: b'"' }),
            )
            .map_err(|_| bun_core::err!("FormatError"))?;
            v
        };

        // Free the previous buffer on regenerate (hot reload) instead of
        // leaking it. `contents` is either "" or a prior allocPrint result.
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
    pub code_buffer: [u8; MAX_PATH_BYTES * 2 + 500],
    pub output_code_buffer: [u8; MAX_PATH_BYTES * 8 + 500],
    pub source: logger::Source,
}

impl Default for MacroEntryPoint {
    fn default() -> Self {
        Self {
            code_buffer: [0u8; MAX_PATH_BYTES * 2 + 500],
            output_code_buffer: [0u8; MAX_PATH_BYTES * 8 + 500],
            source: logger::Source::default(),
        }
    }
}

impl MacroEntryPoint {
    pub fn generate_id(entry_path: &[u8], function_name: &[u8], buf: &mut [u8], len: &mut u32) -> i32 {
        let mut hasher = Wyhash11::init(0);
        hasher.update(js_ast::Macro::NAMESPACE_WITH_COLON);
        hasher.update(entry_path);
        hasher.update(function_name);
        let hash = hasher.final_();
        let fmt = bun_fmt::hex_int_lower(hash);

        let specifier: &[u8] = {
            let mut cursor = std::io::Cursor::new(&mut buf[..]);
            write!(
                &mut cursor,
                concat!("{}", "//{}.js"),
                BStr::new(js_ast::Macro::NAMESPACE_WITH_COLON),
                fmt,
            )
            .expect("unreachable");
            let n = cursor.position() as usize;
            &buf[..n]
        };
        *len = specifier.len() as u32;

        Self::generate_id_from_specifier(specifier)
    }

    pub fn generate_id_from_specifier(specifier: &[u8]) -> i32 {
        // SAFETY: same-size POD bitcast u32 → i32 (matches Zig `@bitCast`).
        unsafe { core::mem::transmute::<u32, i32>(bun_wyhash::hash(specifier) as u32) }
    }

    pub fn generate(
        entry: &mut MacroEntryPoint,
        _: &mut Transpiler,
        import_path: &Fs::PathName,
        function_name: &[u8],
        macro_id: i32,
        macro_label_: &[u8],
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        let dir_to_use: &[u8] = if import_path.dir.is_empty() {
            b""
        } else {
            import_path.dir_with_trailing_slash()
        };
        entry.code_buffer[..macro_label_.len()].copy_from_slice(macro_label_);
        // TODO(port): self-referential — `macro_label` and `code` borrow `entry.code_buffer` and
        // are stored into `entry.source`. Phase B: raw-ptr slice or restructure.
        let macro_label = &entry.code_buffer[..macro_label_.len()];

        let code: &[u8] = 'brk: {
            if import_path.base == b"bun" {
                let mut cursor =
                    std::io::Cursor::new(&mut entry.code_buffer[macro_label.len()..]);
                write!(
                    &mut cursor,
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
                .map_err(|_| bun_core::err!("NoSpaceLeft"))?;
                let n = cursor.position() as usize;
                break 'brk &entry.code_buffer[macro_label.len()..macro_label.len() + n];
            }

            let mut cursor = std::io::Cursor::new(&mut entry.code_buffer[macro_label.len()..]);
            write!(
                &mut cursor,
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
                bun_fmt::fmt_path(dir_to_use, bun_fmt::PathFmtOptions { escape_backslashes: true }),
                bun_fmt::fmt_path(import_path.filename, bun_fmt::PathFmtOptions { escape_backslashes: true }),
                BStr::new(function_name),
                BStr::new(function_name),
                bun_fmt::fmt_path(dir_to_use, bun_fmt::PathFmtOptions { escape_backslashes: true }),
                bun_fmt::fmt_path(import_path.filename, bun_fmt::PathFmtOptions { escape_backslashes: true }),
                macro_id,
                BStr::new(function_name),
            )
            .map_err(|_| bun_core::err!("NoSpaceLeft"))?;
            let n = cursor.position() as usize;
            &entry.code_buffer[macro_label.len()..macro_label.len() + n]
        };

        entry.source = logger::Source::init_path_string(macro_label, code);
        entry.source.path.text = macro_label;
        entry.source.path.namespace = js_ast::Macro::NAMESPACE;
        Ok(())
    }
}

// TODO(port): `TranspilerLike` is a placeholder for the duck-typed
// `comptime TranspilerType: type` param used by FallbackEntryPoint/ClientEntryPoint.
// Phase B: replace with the concrete `Transpiler` type or a real trait once
// `bun_bundler::options` is ported.
pub trait TranspilerLike {
    fn options(&self) -> &crate::options::Options;
}

// TODO(port): `ClientCssInJs` lives in `bun_bundler::options::Framework`; placeholder
// import path until options.rs is ported.
use crate::options::ClientCssInJs;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/entry_points.zig (374 lines)
//   confidence: medium
//   todos:      12
//   notes:      self-referential structs (Source borrows code_buffer) need raw-ptr handling in Phase B; TranspilerType duck-typing stubbed via placeholder trait
// ──────────────────────────────────────────────────────────────────────────

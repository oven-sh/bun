use std::io::Write as _;

use bstr::BStr;

use bun_core::fmt as bun_fmt;
use bun_paths::MAX_PATH_BYTES;
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

#[derive(Default)]
pub struct ClientEntryPoint {
    pub(crate) source: bun_ast::Source,
}

#[derive(Default)]
pub struct ServerEntryPoint {
    /// The source of `bun:main`, once there is an entry point: [`MAIN_SOURCE`] or [`MAIN_SOURCE_WITH_HOT_RELOAD`].
    pub contents: Option<&'static [u8]>,
}

macro_rules! entry_specifier {
    () => {
        "bun:main/entry"
    };
}

impl ServerEntryPoint {
    /// What `bun:main` imports. The module loader's resolve hook answers it with the entry point's path.
    pub const ENTRY_SPECIFIER: &'static [u8] = entry_specifier!().as_bytes();

    pub fn generate(entry: &mut ServerEntryPoint, is_hot_reload_enabled: bool) {
        entry.contents = Some(if is_hot_reload_enabled {
            MAIN_SOURCE_WITH_HOT_RELOAD.as_bytes()
        } else {
            MAIN_SOURCE.as_bytes()
        });
    }
}

/// A static for its one address: `bun_runtime::embedded_code` knows Bun's own module texts by where they are.
pub static MAIN_SOURCE_WITH_HOT_RELOAD: &str = concat!(
    "// @bun\n\
     import * as start from '",
    entry_specifier!(),
    "';\n\
     var hmrSymbol = Symbol(\"BunServerHMR\");\n\
     var entryNamespace = start;\n\
     function isServerConfig(def) {\n\
     \x20  return def && def !== globalThis && (typeof def.fetch === 'function' || def.app != undefined) && typeof def.stop !== 'function';\n\
     }\n\
     if (typeof entryNamespace?.then === 'function') {\n\
     \x20  entryNamespace = entryNamespace.then((entryNamespace) => {\n\
     \x20     var def = entryNamespace?.default;\n\
     \x20     if (isServerConfig(def))  {\n\
     \x20       var server = globalThis[hmrSymbol];\n\
     \x20       if (server) {\n\
     \x20          server.reload(def);\n\
     \x20          console.debug(`Reloaded ${server.development ? 'development ' : ''}server: ${server.protocol}://${server.hostname}:${server.port}`);\n\
     \x20       } else {\n\
     \x20          server = globalThis[hmrSymbol] = Bun.serve(def);\n\
     \x20          console.debug(`Started ${server.development ? 'development ' : ''}server: ${server.protocol}://${server.hostname}:${server.port}`);\n\
     \x20       }\n\
     \x20     }\n\
     \x20  }, reportError);\n\
     } else if (isServerConfig(entryNamespace?.default)) {\n\
     \x20  var server = globalThis[hmrSymbol];\n\
     \x20  if (server) {\n\
     \x20     server.reload(entryNamespace.default);\n\
     \x20     console.debug(`Reloaded ${server.development ? 'development ' : ''}server: ${server.protocol}://${server.hostname}:${server.port}`);\n\
     \x20  } else {\n\
     \x20     server = globalThis[hmrSymbol] = Bun.serve(entryNamespace.default);\n\
     \x20     console.debug(`Started ${server.development ? 'development ' : ''}server: ${server.protocol}://${server.hostname}:${server.port}`);\n\
     \x20  }\n\
     }\n",
);

pub static MAIN_SOURCE: &str = concat!(
    "// @bun\n\
     import * as start from \"",
    entry_specifier!(),
    "\";\n\
     var entryNamespace = start;\n\
     function isServerConfig(def) {\n\
     \x20  return def && def !== globalThis && (typeof def.fetch === 'function' || def.app != undefined) && typeof def.stop !== 'function';\n\
     }\n\
     if (typeof entryNamespace?.then === 'function') {\n\
     \x20  entryNamespace = entryNamespace.then((entryNamespace) => {\n\
     \x20     if (isServerConfig(entryNamespace?.default))  {\n\
     \x20       const server = Bun.serve(entryNamespace.default);\n\
     \x20       console.debug(`Started ${server.development ? 'development ' : ''}server: ${server.protocol}://${server.hostname}:${server.port}`);\n\
     \x20     }\n\
     \x20  }, reportError);\n\
     } else if (isServerConfig(entryNamespace?.default)) {\n\
     \x20  const server = Bun.serve(entryNamespace.default);\n\
     \x20  console.debug(`Started ${server.development ? 'development ' : ''}server: ${server.protocol}://${server.hostname}:${server.port}`);\n\
     }\n",
);

// This is not very fast. The idea is: we want to generate a unique entry point
// per macro function export that registers the macro Registering the macro
// happens in VirtualMachine We "register" it which just marks the JSValue as
// protected. This is mostly a workaround for being unable to call ESM exported
// functions from C++. When that is resolved, we should remove this.
pub struct MacroEntryPoint {
    pub(crate) code_buffer: [u8; MAX_PATH_BYTES * 2 + 500],
    pub source: bun_ast::Source,
}

impl Default for MacroEntryPoint {
    fn default() -> Self {
        Self {
            code_buffer: [0u8; MAX_PATH_BYTES * 2 + 500],
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
    ) -> crate::Result<()> {
        let dir_to_use: &[u8] = if import_path.dir.is_empty() {
            b""
        } else {
            import_path.dir_with_trailing_slash()
        };
        // reshaped for borrowck — capture the label length, write the
        // body via a scoped &mut borrow, then re-borrow `code_buffer` immutably
        // for the (label, code) slices passed to `init_path_string`.
        let label_len = macro_label_.len();
        entry.code_buffer[..label_len].copy_from_slice(macro_label_);

        let code_len: usize = 'brk: {
            if import_path.base == b"bun" {
                let mut cursor = std::io::Cursor::new(&mut entry.code_buffer[label_len..]);
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
                .map_err(|_| crate::Error::Sys(bun_errno::SystemErrno::ENOSPC))?;
                break 'brk cursor.position() as usize;
            }

            let mut cursor = std::io::Cursor::new(&mut entry.code_buffer[label_len..]);
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
            .map_err(|_| crate::Error::Sys(bun_errno::SystemErrno::ENOSPC))?;
            cursor.position() as usize
        };

        // INVARIANT: self-referential — `macro_label`/`code` borrow
        // `entry.code_buffer` and are stored into `entry.source` (lifetime erased
        // via `IntoStr`), so `entry` must not move or drop while `entry.source`
        // is in use.
        let macro_label: &[u8] = &entry.code_buffer[..label_len];
        let code: &[u8] = &entry.code_buffer[label_len..label_len + code_len];
        entry.source = bun_ast::Source::init_path_string(macro_label, code);
        // `Path::init` already set `text = macro_label`; only override namespace.
        entry.source.path.namespace = js_ast::Macro::NAMESPACE;
        Ok(())
    }
}

use std::io::Write as _;

use bun_core::strings;

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
    ) -> crate::Result<()> {
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
                .map_err(|_| crate::Error::FormatError)?;
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
            .map_err(|_| crate::Error::FormatError)?;
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

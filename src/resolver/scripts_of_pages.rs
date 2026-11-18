//! Under which names a desktop app has the scripts of its pages that are no module files.

/// Follows the path of the file.
pub const CLASSIC: &[u8] = b".script.cjs";
/// Follows the path of the file, whose export is a function of [`PRELOAD_PARAMETERS`].
pub const PRELOAD: &[u8] = b".preload.cjs";
pub const PRELOAD_PARAMETERS: &str =
    "require,process,Buffer,global,setImmediate,clearImmediate,exports,module,__filename,__dirname";

/// A file at the root of the executable: what a `file:` URL may load, one path on each line.
pub const LIST: &[u8] = b".scripts-of-pages";

/// In the directory of the page.
pub fn name_of_inline(text: &[u8], is_module: bool) -> Vec<u8> {
    let end: &[u8] = if is_module { b".mjs" } else { CLASSIC };
    let start = format!("inline-{:016x}", bun_wyhash::hash(text));
    [start.as_bytes(), end].concat()
}

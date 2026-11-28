//! Host fns / C++ exports for `node:module` `_nodeModulePaths`. Lives here so
//! `resolver/` has no JSC references.

use crate::HostReturn as _;

use crate::{JSGlobalObject, JSValue};
use bun_core::String as BunString;
use bun_paths::Path;

pub fn module_key_without_query(key: &[u8]) -> &[u8] {
    // The question mark in a Windows device prefix is part of the path.
    let start = if cfg!(windows)
        && key.len() >= 4
        && key[2] == b'?'
        && resolve_path::is_sep_any(key[0])
        && resolve_path::is_sep_any(key[1])
        && resolve_path::is_sep_any(key[3])
    {
        4
    } else {
        0
    };
    match strings::index_of_char_usize(&key[start..], b'?') {
        Some(index) => &key[..start + index],
        None => key,
    }
}

pub(crate) fn node_module_paths(path: &BunString) -> Vec<BunString> {
    crate::mark_binding!();
    node_module_paths_list(path, false)
}

#[unsafe(no_mangle)]
extern "C" fn Resolver__propForRequireMainPaths(global: &JSGlobalObject) -> JSValue {
    crate::mark_binding!();

    node_module_paths_js_value(&BunString::static_("."), global, false)
}

// C++ callers pass a borrowed `const BunString*` (`Bun::toString`).
#[unsafe(export_name = "Resolver__nodeModulePathsJSValue")]
extern "C" fn node_module_paths_js_value(
    in_str: &BunString,
    global: &JSGlobalObject,
    use_dirname: bool,
) -> JSValue {
    crate::bun_string_jsc::to_js_array(global, &node_module_paths_list(in_str, use_dirname))
        .or_pending_exception()
}

fn node_module_paths_list(in_str: &BunString, use_dirname: bool) -> Vec<BunString> {
    let top_level_dir = bun_paths::fs::FileSystem::instance().top_level_dir();
    let utf8 = in_str.to_utf8();
    let base_path = match use_dirname {
        true => bun_paths::dirname_or_root(utf8.slice()),
        false => utf8.slice(),
    };
    let full_path = Path::resolve(&[top_level_dir, base_path]);
    bun_paths::ancestors(&full_path)
        .filter(|dir| bun_paths::components(dir).next_back() != Some(b"node_modules"))
        .map(|dir| BunString::clone_utf8(&Path::from_parts(&[dir, b"node_modules"])))
        .collect()
}

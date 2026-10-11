//! Host fns / C++ exports for `node:module` `_nodeModulePaths`. Lives here so
//! `resolver/` has no JSC references.

use crate::HostReturn as _;
use bstr::BStr;

use crate::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_core::{String as BunString, strings};
use bun_paths::resolve_path;
use bun_paths::{Platform, SEP, SEP_STR};

#[crate::host_fn(export = "Resolver__nodeModulePathsForJS")]
fn node_module_paths_for_js(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    crate::mark_binding!();
    let argument: JSValue = frame.argument(0);

    if argument.is_empty() || !argument.is_string() {
        return Err(global.throw_invalid_argument_type("nodeModulePaths", "path", "string"));
    }

    let in_str = argument.to_bun_string(global)?;
    Ok(node_module_paths_js_value(&in_str, global, false))
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
    let mut list: Vec<bun_core::String> = Vec::new();

    let utf8 = in_str.to_utf8();
    let base_path: &[u8] = if use_dirname {
        resolve_path::dirname::<bun_paths::platform::Auto>(utf8.slice())
    } else {
        utf8.slice()
    };
    let mut buf = bun_paths::path_buffer_pool::get();

    let mut full_path: &[u8] = resolve_path::join_abs_string_buf::<bun_paths::platform::Auto>(
        bun_paths::fs::FileSystem::instance().top_level_dir(),
        &mut **buf,
        &[base_path],
    );
    let root_index: usize = {
        #[cfg(windows)]
        {
            resolve_path::windows_filesystem_root(full_path).len()
        }
        #[cfg(not(windows))]
        {
            1
        }
    };
    // Node begins with `path.resolve(from)`: no trailing separator past root.
    while full_path.len() > root_index
        && Platform::AUTO.is_separator(full_path[full_path.len() - 1])
    {
        full_path = &full_path[..full_path.len() - 1];
    }
    let mut root_path: &[u8] = &full_path[0..root_index];
    if full_path.len() > root_path.len() {
        // Manual backwards-split iteration: we need both the remaining buffer
        // and the split index, which Rust's `rsplit` does not expose.
        let suffix: &[u8] = &full_path[root_index..];
        let mut index: Option<usize> = Some(suffix.len());
        while let Some(end) = index {
            let part: &[u8];
            match strings::last_index_of_char(&suffix[..end], SEP) {
                Some(delim) => {
                    part = &suffix[delim + 1..end];
                    index = Some(delim);
                }
                None => {
                    part = &suffix[..end];
                    index = None;
                }
            }

            if part == b"node_modules" {
                continue;
            }

            let prefix_len = match index {
                Some(i) => i + 1,
                None => 0,
            } + part.len();

            list.push(BunString::create_format(format_args!(
                "{}{}{}node_modules",
                BStr::new(root_path),
                BStr::new(&suffix[..prefix_len]),
                SEP_STR,
            )));
        }
    }

    while !root_path.is_empty() && Platform::AUTO.is_separator(root_path[root_path.len() - 1]) {
        root_path = &root_path[..root_path.len() - 1];
    }

    list.push(BunString::create_format(format_args!(
        "{}{}node_modules",
        BStr::new(root_path),
        SEP_STR,
    )));

    crate::bun_string_jsc::to_js_array(global, &list).or_pending_exception()
}

//! Host fns / C++ exports for `node:module` `_nodeModulePaths`. Extracted from
//! `resolver/resolver.zig` so `resolver/` has no JSC references.

use bstr::BStr;

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_paths::{self, Platform, SEP, SEP_STR};
use bun_str as strings;

#[bun_jsc::host_fn(export_name = "Resolver__nodeModulePathsForJS")]
pub fn node_module_paths_for_js(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    bun_jsc::mark_binding!();
    let argument: JSValue = frame.argument(0);

    if argument.is_empty() || !argument.is_string() {
        return global.throw_invalid_argument_type("nodeModulePaths", "path", "string");
    }

    let in_str = argument.to_bun_string(global)?;
    Ok(node_module_paths_js_value(in_str, global, false))
}

#[unsafe(no_mangle)]
pub extern "C" fn Resolver__propForRequireMainPaths(global: &JSGlobalObject) -> JSValue {
    bun_jsc::mark_binding!();

    let in_str = bun_str::String::init(b".");
    node_module_paths_js_value(in_str, global, false)
}

// TODO(port): C++ callers pass `in_str` by value without transferring a ref; verify
// `bun_str::String` Drop semantics match (Zig callee did not `deref`).
#[unsafe(export_name = "Resolver__nodeModulePathsJSValue")]
pub extern "C" fn node_module_paths_js_value(
    in_str: bun_str::String,
    global: &JSGlobalObject,
    use_dirname: bool,
) -> JSValue {
    // PERF(port): was ArenaAllocator + stackFallback(1024) bulk-free — profile in Phase B
    let mut list: Vec<bun_str::String> = Vec::new();

    let sliced = in_str.to_utf8();
    let base_path: &[u8] = if use_dirname {
        bun_paths::dirname(sliced.slice(), Platform::Auto).unwrap_or(sliced.slice())
    } else {
        sliced.slice()
    };
    let mut buf = bun_paths::path_buffer_pool().get();

    let full_path: &[u8] = bun_paths::join_abs_string_buf(
        bun_fs::FileSystem::instance().top_level_dir,
        &mut *buf,
        &[base_path],
        Platform::Auto,
    );
    let root_index: usize = {
        #[cfg(windows)]
        {
            bun_paths::windows_filesystem_root(full_path).len()
        }
        #[cfg(not(windows))]
        {
            1
        }
    };
    let mut root_path: &[u8] = &full_path[0..root_index];
    if full_path.len() > root_path.len() {
        // PORT NOTE: reshaped for borrowck — `std.mem.splitBackwardsScalar` exposes
        // `.buffer` and `.index`, which Rust's `rsplit` does not. Manual iteration
        // mirrors the Zig SplitBackwardsIterator state machine exactly.
        let suffix: &[u8] = &full_path[root_index..];
        let mut index: Option<usize> = Some(suffix.len());
        while let Some(end) = index {
            let part: &[u8];
            match suffix[..end].iter().rposition(|&b| b == SEP) {
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

            list.push(bun_str::String::create_format(format_args!(
                "{}{}{}node_modules",
                BStr::new(root_path),
                BStr::new(&suffix[..prefix_len]),
                SEP_STR,
            )));
        }
    }

    while !root_path.is_empty() && Platform::Auto.is_separator(root_path[root_path.len() - 1]) {
        root_path = &root_path[..root_path.len() - 1];
    }

    list.push(bun_str::String::create_format(format_args!(
        "{}{}node_modules",
        BStr::new(root_path),
        SEP_STR,
    )));

    // TODO(port): `to_js_array` lives on the `StringJsc` extension trait in this crate.
    bun_str::String::to_js_array(global, list.as_slice()).unwrap_or(JSValue::ZERO)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/resolver_jsc.zig (88 lines)
//   confidence: medium
//   todos:      2
//   notes:      splitBackwardsScalar hand-rolled; verify bun_str::String FFI ownership & create_format/to_js_array signatures
// ──────────────────────────────────────────────────────────────────────────

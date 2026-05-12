//! Host fns / C++ exports for `node:module` `_nodeModulePaths`. Extracted from
//! `resolver/resolver.zig` so `resolver/` has no JSC references.

use bstr::BStr;

use crate::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_core::String as BunString;
use bun_paths::resolve_path;
use bun_paths::{Platform, SEP, SEP_STR};

#[crate::host_fn(export = "Resolver__nodeModulePathsForJS")]
pub fn node_module_paths_for_js(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    crate::mark_binding!();
    let argument: JSValue = frame.argument(0);

    if argument.is_empty() || !argument.is_string() {
        return Err(global.throw_invalid_argument_type("nodeModulePaths", "path", "string"));
    }

    let in_str = argument.to_bun_string(global)?;
    Ok(node_module_paths_js_value(in_str, global, false))
}

#[unsafe(no_mangle)]
pub extern "C" fn Resolver__propForRequireMainPaths(global: &JSGlobalObject) -> JSValue {
    crate::mark_binding!();

    let in_str = BunString::static_(b".");
    node_module_paths_js_value(in_str, global, false)
}

// TODO(port): C++ callers pass `in_str` by value without transferring a ref; verify
// `bun_core::String` Drop semantics match (Zig callee did not `deref`).
#[unsafe(export_name = "Resolver__nodeModulePathsJSValue")]
pub extern "C" fn node_module_paths_js_value(
    in_str: BunString,
    global: &JSGlobalObject,
    use_dirname: bool,
) -> JSValue {
    // PERF(port): was ArenaAllocator + stackFallback(1024) bulk-free — profile in Phase B
    let mut list: Vec<BunString> = Vec::new();

    let sliced = in_str.to_utf8();
    let base_path: &[u8] = if use_dirname {
        resolve_path::dirname::<bun_paths::platform::Auto>(sliced.slice())
    } else {
        sliced.slice()
    };
    let mut buf = bun_paths::path_buffer_pool::get();

    let full_path: &[u8] = resolve_path::join_abs_string_buf::<bun_paths::platform::Auto>(
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

    list.as_slice().to_js_array(global).unwrap_or(JSValue::ZERO)
}

/// `[bun.String]::to_js_array` lives on the `StringArrayJsc` ext trait below
/// (mirrors `bun_string_jsc.zig`'s `BunString__createArray`).
trait StringArrayJsc {
    fn to_js_array(&self, global: &JSGlobalObject) -> JsResult<JSValue>;
}
impl StringArrayJsc for [BunString] {
    fn to_js_array(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        unsafe extern "C" {
            fn BunString__createArray(
                global: &JSGlobalObject,
                ptr: *const BunString,
                len: usize,
            ) -> JSValue;
        }
        crate::host_fn::from_js_host_call(global, || unsafe {
            BunString__createArray(global, self.as_ptr(), self.len())
        })
    }
}

// ported from: src/jsc/resolver_jsc.zig

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
    // PERF(port): was ArenaAllocator + stackFallback(1024) bulk-free — profile if hot.
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

/// Testing bridges for `bun.resolver.package_json.SideEffects`. Exposed
/// via `bun:internal-for-testing` so the #30320 regression test can drive
/// the glob/exact matchers with synthetic Windows-style paths on any
/// host. Not used by production code.
pub mod side_effects_testing {
    use super::*;
    use bun_resolver::package_json::{
        FileSystemPackageJsonExt, MixedPatterns, SideEffects, StringHashMapUnownedKey,
    };

    /// Mirrors `PackageJSON::normalize_path_for_glob` — backslashes → slashes.
    /// Inlined here so the testing helper stays compilable even when the
    /// resolver's private helper changes signature (it's intentionally private
    /// in production to keep the matcher's surface small).
    fn normalize(path: &[u8]) -> Vec<u8> {
        let mut v = path.to_vec();
        bun_paths::slashes_to_posix_in_place(&mut v[..]);
        v
    }

    /// `sideEffectsHasSideEffects(dir, patterns, path, usePreFix) -> bool`
    ///
    /// - `dir`       — absolute directory the package.json "lives in",
    ///                 with trailing separator. Pass `C:\pkg\` to simulate
    ///                 a Windows package root on a Linux host.
    /// - `patterns`  — `sideEffects` array, e.g. `["adapters/**/*.js"]`.
    /// - `path`      — runtime path the resolver would hand to
    ///                 `has_side_effects`, e.g. `C:\pkg\adapters\foo.js`.
    /// - `usePreFix` — when truthy, build patterns through the old
    ///                 `r_fs.join` path so tests can assert the bug
    ///                 actually regressed. Default false (fixed path).
    ///
    /// Returns `true` iff `path` matches any pattern. Before the fix,
    /// Windows-shaped inputs always returned `false` because the stored
    /// pattern carried a leading `/` that the runtime path never did.
    pub fn side_effects_has_side_effects(
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = frame.arguments_old::<4>();
        let args = args.slice();
        if args.len() < 3 {
            return Err(global.throw(format_args!(
                "sideEffectsHasSideEffects(dir, patterns, path, usePreFix?) takes 3 or 4 arguments"
            )));
        }

        let dir_bunstr = args[0].to_bun_string(global)?;
        let dir_utf8 = dir_bunstr.to_utf8();
        let patterns_val = args[1];
        let path_bunstr = args[2].to_bun_string(global)?;
        let path_utf8 = path_bunstr.to_utf8();
        let use_pre_fix = args.len() >= 4 && args[3].to_boolean();

        if !patterns_val.is_array() {
            return Err(global.throw_type_error(format_args!(
                "sideEffectsHasSideEffects: patterns must be an array"
            )));
        }

        // SAFETY: `bun_vm()` is non-null on a Bun-owned global; `transpiler.resolver`
        // is initialized at VM init. We only use the FileSystem field through the
        // raw pointer; no aliasing with other host fns (JS single-threaded).
        let vm = global.bun_vm().as_mut();
        let r_fs: &mut bun_resolver::fs::FileSystem = unsafe { &mut *vm.transpiler.resolver.fs };

        let dir = dir_utf8.slice();
        let len = patterns_val.get_length(global)? as u32;

        // Build a `SideEffects` value from the patterns just like `parse` would.
        let mut map = bun_resolver::package_json::SideEffectsMap::with_capacity(len as usize);
        let mut glob_list = bun_resolver::package_json::GlobList::with_capacity(len as usize);
        let mut has_globs = false;
        let mut has_exact = false;

        for i in 0..len {
            let item = patterns_val.get_index(global, i)?;
            let item_bunstr = item.to_bun_string(global)?;
            let item_utf8 = item_bunstr.to_utf8();
            let name = item_utf8.slice();

            let joined: [&[u8]; 2] = [dir, name];
            // Build the pattern through the same helper production code uses,
            // OR through the pre-fix `r_fs.join` so the test can observe both.
            let pattern_vec: Vec<u8> = if use_pre_fix {
                FileSystemPackageJsonExt::join(r_fs, &joined).to_vec()
            } else {
                r_fs.abs(&joined).to_vec()
            };
            let normalized_pattern = normalize(&pattern_vec);

            let is_glob = name.iter().any(|&b| matches!(b, b'*' | b'?' | b'[' | b'{'));
            if is_glob {
                glob_list.push(normalized_pattern.into_boxed_slice());
                has_globs = true;
            } else {
                let _ =
                    map.insert(StringHashMapUnownedKey::init(&normalized_pattern), ());
                has_exact = true;
            }
        }

        let side_effects = if has_globs && has_exact {
            SideEffects::Mixed(MixedPatterns {
                exact: map,
                globs: glob_list,
            })
        } else if has_globs {
            SideEffects::Glob(glob_list)
        } else {
            SideEffects::Map(map)
        };

        let matched = side_effects.has_side_effects(path_utf8.slice());
        Ok(JSValue::js_boolean(matched))
    }
}

// ported from: src/jsc/resolver_jsc.zig

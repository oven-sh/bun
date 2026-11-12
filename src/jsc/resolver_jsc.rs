//! Host fns / C++ exports for `node:module` `_nodeModulePaths`. Lives here so
//! `resolver/` has no JSC references.

use crate::HostReturn as _;
use bstr::BStr;

use crate::{JSGlobalObject, JSValue};
use bun_core::{String as BunString, strings};
use bun_paths::resolve_path;
use bun_paths::{Platform, SEP, SEP_STR};

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
    let mut list: Vec<bun_core::String> = Vec::new();
    let utf8 = in_str.to_utf8();
    let (full_path, root_index) = resolved_directory(utf8.slice(), use_dirname);
    for_each_directory_above(full_path, root_index, |directory| {
        list.push(BunString::create_format(format_args!(
            "{}{}node_modules",
            BStr::new(directory),
            SEP_STR,
        )));
        true
    });
    list
}

/// Node's `path.resolve(from)`, or that of the directory of `from`, and the length of its root.
/// The path lies in the buffer of `join_abs_string`.
fn resolved_directory(from: &[u8], use_dirname: bool) -> (&'static [u8], usize) {
    let base_path: &[u8] = if use_dirname {
        resolve_path::dirname::<bun_paths::platform::Auto>(from)
    } else {
        from
    };
    // Like Node's `_nodeModulePaths`, this is pure string manipulation, so there's no length limit.
    let mut full_path: &[u8] = resolve_path::join_abs_string::<bun_paths::platform::Auto>(
        bun_paths::fs::FileSystem::instance().top_level_dir(),
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
    (full_path, root_index)
}

/// Calls `visit` with each directory whose `node_modules` Node's `Module._nodeModulePaths` lists
/// for `full_path`, nearest first, until it answers `false`. A directory comes without a trailing
/// separator, so the root of a POSIX filesystem is the empty string.
fn for_each_directory_above(
    full_path: &[u8],
    root_index: usize,
    mut visit: impl FnMut(&[u8]) -> bool,
) {
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

            if !visit(&full_path[..root_index + prefix_len]) {
                return;
            }
        }
    }

    while !root_path.is_empty() && Platform::AUTO.is_separator(root_path[root_path.len() - 1]) {
        root_path = &root_path[..root_path.len() - 1];
    }

    visit(root_path);
}

/// For NodeModuleModule.cpp: `node_module_paths_run` over the `len` strings at `directories`.
///
/// # Safety
/// `directories` must be null or point to `len` initialized `BunString`s that remain valid for
/// the duration of this call.
#[unsafe(no_mangle)]
unsafe extern "C" fn Resolver__nodeModulePathsRun(
    filename: &BunString,
    directories: *const BunString,
    len: usize,
    start: &mut usize,
    end: &mut usize,
) -> bool {
    let directories: &[BunString] = if len == 0 {
        &[]
    } else {
        // SAFETY: the C++ caller passes `len` initialized `BunString`s that outlive this call; `len > 0` here.
        unsafe { core::slice::from_raw_parts(directories, len) }
    };
    let Some(run) = node_module_paths_run(filename.to_utf8().slice(), directories) else {
        return false;
    };
    *start = run.start;
    *end = run.end;
    true
}

/// Where in `directories` the list that `Module._nodeModulePaths` gives for the directory of
/// `filename` stands, whole and in order. That list is the `paths` of a CommonJS module at
/// `filename` until script changes them.
pub fn node_module_paths_run(
    filename: &[u8],
    directories: &[BunString],
) -> Option<core::ops::Range<usize>> {
    const NODE_MODULES: &[u8] = b"node_modules";
    let (full_path, root_index) = resolved_directory(filename, true);
    // An ASCII path is compared in the encoding that `listed` has. Any other goes through UTF-8.
    let is_ascii = strings::is_all_ascii(full_path);
    let names = |listed: &BunString, directory: &[u8]| {
        if is_ascii {
            let listed = listed.to_encoded_slice();
            return listed.len == directory.len() + 1 + NODE_MODULES.len()
                && listed.starts_with_ascii(directory)
                && listed.char_at(directory.len()) == u16::from(SEP)
                && listed.substring(directory.len() + 1).eq_ascii(NODE_MODULES);
        }
        let listed = listed.to_utf8();
        let listed = listed.slice();
        listed.len() == directory.len() + 1 + NODE_MODULES.len()
            && listed.starts_with(directory)
            && listed[directory.len()] == SEP
            && listed.ends_with(NODE_MODULES)
    };
    (0..directories.len()).find_map(|start| {
        // `None`: an entry is another directory, or `directories` ended before the list did.
        let mut end = Some(start);
        for_each_directory_above(full_path, root_index, |directory| {
            end = end.filter(|&at| (directories.get(at)).is_some_and(|it| names(it, directory)));
            end = end.map(|at| at + 1);
            end.is_some()
        });
        end.map(|end| start..end)
    })
}

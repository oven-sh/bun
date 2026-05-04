// maybe rename to `PackageJSONCache` if we cache more than workspaces

use bun_collections::StringHashMap;
use bun_core::Error;
use bun_js_parser::Expr;
use bun_js_printer::options::Indentation;
use bun_logger::{Log, Source};
use bun_paths::{self, is_absolute, PathBuffer};
use bun_sys::File;

use bun_install::initialize_store;
use bun_json as json;

pub struct MapEntry {
    pub root: Expr,
    pub source: Source,
    pub indentation: Indentation,
}

impl Default for MapEntry {
    fn default() -> Self {
        Self {
            root: Expr::default(),
            source: Source::default(),
            indentation: Indentation::default(),
        }
    }
}

pub type Map = StringHashMap<MapEntry>;

#[derive(Clone, Copy)]
pub struct GetJSONOptions {
    pub init_reset_store: bool,
    pub guess_indentation: bool,
}

impl Default for GetJSONOptions {
    fn default() -> Self {
        Self {
            init_reset_store: true,
            guess_indentation: false,
        }
    }
}

pub enum GetResult<'a> {
    Entry(&'a mut MapEntry),
    ReadErr(Error),
    ParseErr(Error),
}

impl<'a> GetResult<'a> {
    pub fn unwrap(self) -> Result<&'a mut MapEntry, Error> {
        // TODO(port): narrow error set
        match self {
            GetResult::Entry(entry) => Ok(entry),
            GetResult::ReadErr(err) => Err(err),
            GetResult::ParseErr(err) => Err(err),
        }
    }
}

#[derive(Default)]
pub struct WorkspacePackageJSONCache {
    pub map: Map,
}

impl WorkspacePackageJSONCache {
    /// Given an absolute path to a workspace package.json, return the AST
    /// and contents of the file. If the package.json is not present in the
    /// cache, it will be read from disk and parsed, and stored in the cache.
    pub fn get_with_path(
        &mut self,
        log: &mut Log,
        abs_package_json_path: &[u8],
        // PERF(port): was comptime monomorphization — profile in Phase B
        opts: GetJSONOptions,
    ) -> GetResult<'_> {
        debug_assert!(is_absolute(abs_package_json_path));

        #[cfg(windows)]
        let mut buf = PathBuffer::uninit();
        #[cfg(not(windows))]
        let path: &[u8] = abs_package_json_path;
        #[cfg(windows)]
        let path: &[u8] = {
            buf[..abs_package_json_path.len()].copy_from_slice(abs_package_json_path);
            bun_paths::dangerously_convert_path_to_posix_in_place::<u8>(
                &mut buf[..abs_package_json_path.len()],
            );
            &buf[..abs_package_json_path.len()]
        };

        let entry = self.map.get_or_put(path);
        if entry.found_existing {
            return GetResult::Entry(entry.value_ptr);
        }

        // TODO(port): Zig used a single dupeZ for both the map key and File::to_source.
        // Here we allocate a ZStr for to_source and a separate Box<[u8]> for the map key
        // (assigned after success below, matching get_with_source). StringHashMap key
        // ownership semantics in Rust TBD.
        let key = bun_str::ZStr::from_bytes(path);

        let source = match File::to_source(&key, Default::default()) {
            Ok(s) => s,
            Err(err) => {
                let _ = self.map.remove(key.as_bytes());
                drop(key);
                return GetResult::ReadErr(err.into());
            }
        };

        if opts.init_reset_store {
            initialize_store();
        }

        let json_result = json::parse_package_json_utf8_with_opts(
            &source,
            log,
            json::ParseOptions {
                is_json: true,
                allow_comments: true,
                allow_trailing_commas: true,
                guess_indentation: opts.guess_indentation,
                ..Default::default()
            },
        );

        let parsed = match json_result {
            Ok(p) => p,
            Err(err) => {
                let _ = self.map.remove(key.as_bytes());
                // TODO(port): bun.handleErrorReturnTrace(err, @errorReturnTrace()) — no Rust equivalent
                return GetResult::ParseErr(err.into());
            }
        };

        *entry.value_ptr = MapEntry {
            root: parsed.root.deep_clone(),
            source,
            indentation: parsed.indentation,
        };

        *entry.key_ptr = Box::<[u8]>::from(path);

        GetResult::Entry(entry.value_ptr)
    }

    /// source path is used as the key, needs to be absolute
    pub fn get_with_source(
        &mut self,
        log: &mut Log,
        source: &Source,
        // PERF(port): was comptime monomorphization — profile in Phase B
        opts: GetJSONOptions,
    ) -> GetResult<'_> {
        debug_assert!(is_absolute(source.path.text()));

        #[cfg(windows)]
        let mut buf = PathBuffer::uninit();
        #[cfg(not(windows))]
        let path: &[u8] = source.path.text();
        #[cfg(windows)]
        let path: &[u8] = {
            let text = source.path.text();
            buf[..text.len()].copy_from_slice(text);
            bun_paths::dangerously_convert_path_to_posix_in_place::<u8>(&mut buf[..text.len()]);
            &buf[..text.len()]
        };

        let entry = self.map.get_or_put(path);
        if entry.found_existing {
            return GetResult::Entry(entry.value_ptr);
        }

        if opts.init_reset_store {
            initialize_store();
        }

        let json_result = json::parse_package_json_utf8_with_opts(
            source,
            log,
            json::ParseOptions {
                is_json: true,
                allow_comments: true,
                allow_trailing_commas: true,
                guess_indentation: opts.guess_indentation,
                ..Default::default()
            },
        );

        let parsed = match json_result {
            Ok(p) => p,
            Err(err) => {
                let _ = self.map.remove(path);
                return GetResult::ParseErr(err.into());
            }
        };

        *entry.value_ptr = MapEntry {
            root: parsed.root.deep_clone(),
            source: source.clone(),
            indentation: parsed.indentation,
        };

        *entry.key_ptr = Box::<[u8]>::from(path);

        GetResult::Entry(entry.value_ptr)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/PackageManager/WorkspacePackageJSONCache.zig (161 lines)
//   confidence: medium
//   todos:      3
//   notes:      get_or_put entry borrow overlaps self.map.remove on error path — Phase B must reshape (remove-then-reinsert or raw entry API); StringHashMap key ownership TBD (both fns now store owned Box<[u8]>); comptime GetJSONOptions demoted to runtime
// ──────────────────────────────────────────────────────────────────────────

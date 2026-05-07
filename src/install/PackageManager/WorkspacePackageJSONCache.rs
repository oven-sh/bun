// maybe rename to `PackageJSONCache` if we cache more than workspaces

use bun_collections::StringHashMap;
use bun_core::Error;
// `Expr` here is the JSON parser's AST node (`bun_logger::js_ast::Expr`, re-
// exported via `crate::bun_json`). It is intentionally NOT `bun_js_parser::Expr`
// — that lives in a higher-tier crate and is a distinct type. Consumers of
// `MapEntry.root` (e.g. `Package::parse_with_json`) take the lower-tier
// `bun_json::Expr`, so storing the parser-crate type here would create a
// cross-tier mismatch.
use crate::bun_json::Expr;
use bun_js_printer::options::Indentation;
use bun_logger::{Log, Source};
use bun_paths::{self, is_absolute, PathBuffer};
use bun_sys::File;

use bun_install::initialize_store;
use crate::bun_json as json;

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

// PORT NOTE: Zig `JSON.parsePackageJSONUTF8WithOpts` takes `comptime opts:
// js_lexer.JSONOptions`; the Rust port (`bun_interchange::json`) spells those
// out as 8 const-generic bools. The only field this module varies at runtime
// is `guess_indentation` (because `GetJSONOptions` was demoted from comptime
// to runtime), so dispatch on that one bool here and keep the rest fixed to
// match the Zig call sites (.is_json/.allow_comments/.allow_trailing_commas
// = true, others default false).
fn parse_package_json(
    source: &Source,
    log: &mut Log,
    bump: &bun_alloc::Arena,
    guess_indentation: bool,
) -> Result<json::JsonResult, bun_core::Error> {
    if guess_indentation {
        json::parse_package_json_utf8_with_opts::<
            true,  // IS_JSON
            true,  // ALLOW_COMMENTS
            true,  // ALLOW_TRAILING_COMMAS
            false, // IGNORE_LEADING_ESCAPE_SEQUENCES
            false, // IGNORE_TRAILING_ESCAPE_SEQUENCES
            false, // JSON_WARN_DUPLICATE_KEYS
            false, // WAS_ORIGINALLY_MACRO
            true,  // GUESS_INDENTATION
        >(source, log, bump)
    } else {
        json::parse_package_json_utf8_with_opts::<
            true,  // IS_JSON
            true,  // ALLOW_COMMENTS
            true,  // ALLOW_TRAILING_COMMAS
            false, // IGNORE_LEADING_ESCAPE_SEQUENCES
            false, // IGNORE_TRAILING_ESCAPE_SEQUENCES
            false, // JSON_WARN_DUPLICATE_KEYS
            false, // WAS_ORIGINALLY_MACRO
            false, // GUESS_INDENTATION
        >(source, log, bump)
    }
}

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

        let json_bump = bun_alloc::Arena::new();
        let json_result = parse_package_json(&source, log, &json_bump, opts.guess_indentation);

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

        let json_bump = bun_alloc::Arena::new();
        let json_result = parse_package_json(source, log, &json_bump, opts.guess_indentation);

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

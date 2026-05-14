// maybe rename to `PackageJSONCache` if we cache more than workspaces

use bun_collections::StringHashMap;
use bun_core::Error;
// `Expr` here is the JSON parser's AST node (`bun_ast::Expr`, re-
// exported via `crate::bun_json`). It is intentionally NOT `bun_ast::Expr`
// — that lives in a higher-tier crate and is a distinct type. Consumers of
// `MapEntry.root` (e.g. `Package::parse_with_json`) take the lower-tier
// `bun_json::Expr`, so storing the parser-crate type here would create a
// cross-tier mismatch.
use crate::bun_json::Expr;
// LAYERING: `Indentation` lives in `bun_ast::js_printer` (T2, MOVE_DOWN from
// `bun_js_printer::PrintJsonOptions` see no mismatch.
use bun_ast::Indentation;
use bun_ast::{Log, Source};
#[cfg(windows)]
use bun_paths::PathBuffer;
use bun_paths::is_absolute;

use crate::bun_json as json;
use crate::initialize_store;

pub struct MapEntry {
    pub root: Expr,
    pub source: Source,
    pub indentation: Indentation,
    /// Owns the path bytes that `source.path.{text,pretty,name.*}` borrow.
    /// In Zig the duped path is stored as `entry.key_ptr.*` and `toSource`
    /// is called on that same allocation, so the source's path slices stay
    /// valid for the entry's lifetime. `StringHashMap` boxes its own key,
    /// so keep the `dupeZ` alive here instead.
    path_storage: bun_core::ZBox,
    /// Owns the arena that backs decoded string bytes inside `root`.
    /// Zig passes `bun.default_allocator` to the JSON parser so escape-decoded
    /// `E.String.data` slices live forever; `deepClone` does *not* dupe them.
    /// In Rust the parser takes a `&Arena`, so the arena must outlive the
    /// cached AST — hold it here so it drops with the entry.
    ///
    /// Public so editors that splice new `Expr` nodes into `root`
    /// (e.g. `update_interactive_command::update_package_json_files_from_updates`)
    /// can allocate those nodes here instead of in the resettable `Store` —
    /// the cached `root` outlives `initialize_store()` resets.
    pub json_arena: bun_alloc::Arena,
}

impl Default for MapEntry {
    fn default() -> Self {
        Self {
            root: Expr::default(),
            source: Source::default(),
            indentation: Indentation::default(),
            path_storage: bun_core::ZBox::default(),
            json_arena: bun_alloc::Arena::new(),
        }
    }
}

impl MapEntry {
    /// Re-parse `self.source.contents` into `self.root`.
    ///
    /// `updatePackageJSONAndInstall` edits a copy of `root`, prints it, and
    /// writes the printed JSON back into `source.contents`. The caller then
    /// invokes this to restore the invariant `root == parse(source)`.
    pub fn reparse_root(&mut self, log: &mut Log) -> Result<(), Error> {
        let json_bump = bun_alloc::Arena::new();
        let parsed = parse_package_json(&self.source, log, &json_bump, false)?;
        self.root = bun_core::handle_oom(parsed.root.deep_clone(&json_bump));
        self.json_arena = json_bump;
        Ok(())
    }
}

pub type Map = StringHashMap<MapEntry>;

// PORT NOTE: Zig `JSON.parsePackageJSONUTF8WithOpts` takes `comptime opts:
// js_lexer.JSONOptions`; the Rust port (`bun_parsers::json`) spells those
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

        // PORT NOTE: reshaped for borrowck — Zig `getOrPut` reserves a slot
        // first and `remove`s on failure while still holding `entry.value_ptr`.
        // Rust cannot hold the entry borrow across `self.map.remove`, so check
        // membership up front and only insert into the map after a successful
        // read+parse. Net map state is identical on every path.
        if self.map.contains_key(path) {
            return GetResult::Entry(self.map.get_mut(path).unwrap());
        }

        // Zig: `allocator.dupeZ(u8, path)` — owned NUL-terminated copy reused
        // both as the map key and the path handed to `File.toSource`. The
        // returned `Source` *borrows* its `path` slices from this allocation,
        // so it must outlive the cached `MapEntry` (stored as
        // `value.path_storage` below).
        let key = bun_core::ZBox::from_bytes(path);

        // MOVE_DOWN: `bun.sys.File.toSource` lives in `bun_logger` (T1 → T2
        // cyclebreak; `bun_sys` cannot name `Source`).
        let source = match bun_ast::to_source(&key, Default::default()) {
            Ok(s) => s,
            Err(err) => {
                return GetResult::ReadErr(err.into());
            }
        };

        if opts.init_reset_store {
            initialize_store();
        }

        let json_bump = bun_alloc::Arena::new();
        let parsed = match parse_package_json(&source, log, &json_bump, opts.guess_indentation) {
            Ok(p) => p,
            Err(err) => {
                // Zig: `bun.handleErrorReturnTrace(err, @errorReturnTrace())` — no Rust equivalent.
                return GetResult::ParseErr(err);
            }
        };

        let value = MapEntry {
            root: bun_core::handle_oom(parsed.root.deep_clone(&json_bump)),
            source,
            indentation: parsed.indentation,
            // `source.path` borrows this allocation; the `Box<[u8]>` heap
            // address is stable across the move into the map.
            path_storage: key,
            json_arena: json_bump,
        };

        let entry = bun_core::handle_oom(self.map.get_or_put(path));
        debug_assert!(!entry.found_existing);
        *entry.value_ptr = value;

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

        // PORT NOTE: reshaped for borrowck — see `get_with_path` above.
        if self.map.contains_key(path) {
            return GetResult::Entry(self.map.get_mut(path).unwrap());
        }

        if opts.init_reset_store {
            initialize_store();
        }

        let json_bump = bun_alloc::Arena::new();
        let parsed = match parse_package_json(source, log, &json_bump, opts.guess_indentation) {
            Ok(p) => p,
            Err(err) => {
                return GetResult::ParseErr(err);
            }
        };

        let value = MapEntry {
            root: bun_core::handle_oom(parsed.root.deep_clone(&json_bump)),
            source: source.clone(),
            indentation: parsed.indentation,
            path_storage: bun_core::ZBox::default(),
            json_arena: json_bump,
        };

        let entry = bun_core::handle_oom(self.map.get_or_put(path));
        debug_assert!(!entry.found_existing);
        *entry.value_ptr = value;

        GetResult::Entry(entry.value_ptr)
    }
}

// ported from: src/install/PackageManager/WorkspacePackageJSONCache.zig

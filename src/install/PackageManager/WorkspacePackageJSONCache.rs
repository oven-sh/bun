// maybe rename to `PackageJSONCache` if we cache more than workspaces

use crate::bun_json::Expr;
use bun_collections::StringHashMap;
use bun_core::Error;
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
    _path_storage: bun_core::ZBox,
    pub json_arena: bun_alloc::Arena,
    /// Superseded `source.contents` buffers, pinned so cached `root` slices
    /// stay valid; freed when the entry drops.
    pub stale_contents: Vec<std::borrow::Cow<'static, [u8]>>,
}

impl Default for MapEntry {
    fn default() -> Self {
        Self {
            root: Expr::default(),
            source: Source::default(),
            indentation: Indentation::default(),
            _path_storage: bun_core::ZBox::default(),
            json_arena: bun_alloc::Arena::new(),
            stale_contents: Vec::new(),
        }
    }
}

impl MapEntry {
    pub fn reparse_root(&mut self, log: &mut Log) -> Result<(), Error> {
        let json_bump = bun_alloc::Arena::new();
        let parsed = parse_package_json(&self.source, log, &json_bump, false)?;
        self.root = bun_core::handle_oom(parsed.root.deep_clone(&json_bump));
        self.json_arena = json_bump;
        Ok(())
    }
}

pub type Map = StringHashMap<MapEntry>;

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
        // PERF(port): was comptime monomorphization — profile if hot
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

        if self.map.contains_key(path) {
            return GetResult::Entry(self.map.get_mut(path).unwrap());
        }

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
            _path_storage: key,
            json_arena: json_bump,
            stale_contents: Vec::new(),
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
        // PERF(port): was comptime monomorphization — profile if hot
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
            _path_storage: bun_core::ZBox::default(),
            json_arena: json_bump,
            stale_contents: Vec::new(),
        };

        let entry = bun_core::handle_oom(self.map.get_or_put(path));
        debug_assert!(!entry.found_existing);
        *entry.value_ptr = value;

        GetResult::Entry(entry.value_ptr)
    }
}

// ported from: src/install/PackageManager/WorkspacePackageJSONCache.zig

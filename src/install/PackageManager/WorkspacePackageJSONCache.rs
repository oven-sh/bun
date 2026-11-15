// maybe rename to `PackageJSONCache` if we cache more than workspaces

use crate::Error;
use bun_collections::StringHashMap;
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
use bun_ast::{AstArena, Log, Source};
use bun_js_printer as js_printer;
use bun_paths::is_absolute;

use crate::bun_json as json;
use std::borrow::Cow;

pub struct MapEntry {
    /// Allocated in `WorkspacePackageJSONCache::arena`, or in `save_arena` after [`Self::save`].
    pub root: Expr,
    pub source: Source<'static>,
    pub indentation: Indentation,
    indentation_guessed: bool,
    /// Owns the path bytes that `source.path.{text,pretty,name.*}` borrow,
    /// so the source's path slices stay valid for the entry's lifetime.
    /// `StringHashMap` boxes its own key, so keep the duped copy alive here.
    _path_storage: bun_core::ZBox,
    /// Superseded `source.contents` buffers: slices of an earlier `root` point into them.
    stale_contents: Vec<Cow<'static, [u8]>>,
    save_arena: AstArena,
}

impl MapEntry {
    /// `root` as the text of a package.json, in the entry's indentation.
    pub(crate) fn print(&self, root: Expr) -> Result<Vec<u8>, js_printer::Error> {
        let mut buffer_writer = js_printer::BufferWriter::init();
        buffer_writer
            .buffer
            .list
            .reserve(self.source.contents.len() + 1);
        buffer_writer.append_newline = self.source.contents.last() == Some(&b'\n');
        let mut writer = js_printer::BufferPrinter::init(buffer_writer);
        js_printer::print_json(
            &mut writer,
            root,
            &self.source,
            js_printer::PrintJsonOptions {
                indent: self.indentation,
                mangled_props: None,
                ..Default::default()
            },
        )?;
        Ok(writer.ctx.written_without_trailing_zero().to_vec())
    }

    /// Replaces the text and the tree together: prints `root`, then parses what it printed.
    pub fn save(&mut self, root: Expr, log: &Log) -> Result<(), Error> {
        let printed = Source {
            path: self.source.path,
            contents: Cow::Owned(self.print(root)?),
            ..Default::default()
        };
        let root = parse_package_json(&printed, log, &mut self.save_arena, false)?.root;
        // Moving the `Vec` keeps its buffer, which `root` points into.
        let old = core::mem::replace(&mut self.source.contents, printed.contents);
        self.stale_contents.push(old);
        self.root = root;
        Ok(())
    }
}

pub type Map = StringHashMap<MapEntry>;

fn parse_package_json(
    source: &Source,
    log: &Log,
    bump: &mut AstArena,
    guess_indentation: bool,
) -> Result<json::JsonResult, crate::Error> {
    // Auto-install uses the cache from whichever thread is resolving.
    bump.unlock_thread();
    // The lists of the tree outlive the `AstAlloc` state of the caller.
    let _detached = bun_alloc::ast_alloc::DetachAstHeap::new();
    Ok(json::parse_package_json_utf8_with_opts(
        json::JSONOptions {
            json_warn_duplicate_keys: false,
            guess_indentation,
            ..json::PACKAGE_JSON_OPTS
        },
        source,
        log,
        bump,
    )?)
}

#[derive(Clone, Copy, Default)]
pub struct GetJSONOptions {
    pub guess_indentation: bool,
}

pub enum GetResult<'a> {
    Entry(&'a mut MapEntry),
    ReadErr(Error),
    ParseErr(Error),
}

impl<'a> GetResult<'a> {
    pub(crate) fn unwrap(self) -> Result<&'a mut MapEntry, Error> {
        match self {
            GetResult::Entry(entry) => Ok(entry),
            GetResult::ReadErr(err) => Err(err),
            GetResult::ParseErr(err) => Err(err),
        }
    }
}

pub struct WorkspacePackageJSONCache {
    pub map: Map,
    arena: AstArena,
}

impl Default for WorkspacePackageJSONCache {
    fn default() -> Self {
        Self {
            map: Map::default(),
            arena: AstArena::borrowing_default(),
        }
    }
}

impl WorkspacePackageJSONCache {
    /// Given an absolute path to a workspace package.json, return the AST
    /// and contents of the file. If the package.json is not present in the
    /// cache, it will be read from disk and parsed, and stored in the cache.
    pub fn get_with_path(
        &mut self,
        log: &Log,
        abs_package_json_path: &[u8],
        opts: GetJSONOptions,
    ) -> GetResult<'_> {
        self.get_or_insert(log, abs_package_json_path, opts, None)
    }

    /// `contents` is the text of a package.json that's never written to disk (`bun add --dry-run`).
    pub(crate) fn insert_unwritten(
        &mut self,
        log: &Log,
        abs_package_json_path: &[u8],
        contents: &'static [u8],
    ) -> Result<(), Error> {
        self.get_or_insert(
            log,
            abs_package_json_path,
            GetJSONOptions::default(),
            Some(contents),
        )
        .unwrap()
        .map(drop)
    }

    fn get_or_insert(
        &mut self,
        log: &Log,
        abs_package_json_path: &[u8],
        opts: GetJSONOptions,
        unwritten: Option<&'static [u8]>,
    ) -> GetResult<'_> {
        debug_assert!(is_absolute(abs_package_json_path));

        #[cfg(windows)]
        let mut buf = bun_paths::path_buffer_pool::get();
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

        // reshaped for borrowck — we cannot hold an entry borrow across
        // `self.map.remove`, so check
        // membership up front and only insert into the map after a successful
        // read+parse. Net map state is identical on every path.
        if self.map.contains_key(path) {
            let entry = self.map.get_mut(path).unwrap();
            if opts.guess_indentation && !entry.indentation_guessed {
                entry.indentation = json::guess_indentation(&entry.source.contents);
                entry.indentation_guessed = true;
            }
            return GetResult::Entry(self.map.get_mut(path).unwrap());
        }

        // Owned NUL-terminated copy reused
        // both as the map key and the path handed to `File.toSource`. The
        // returned `Source` *borrows* its `path` slices from this allocation,
        // so it must outlive the cached `MapEntry` (stored as
        // `value.path_storage` below).
        let key = bun_core::ZBox::from_bytes(path);

        // MOVE_DOWN: `bun.sys.File.toSource` lives in `bun_logger` (T1 → T2
        // cyclebreak; `bun_sys` cannot name `Source`).
        let source = match unwritten {
            Some(contents) => Source::init_path_string(key.as_bytes(), contents),
            None => match bun_ast::to_source(&key, Default::default()) {
                Ok(s) => s,
                Err(err) => {
                    return GetResult::ReadErr(err.into());
                }
            },
        };

        let parsed = match parse_package_json(&source, log, &mut self.arena, opts.guess_indentation)
        {
            Ok(p) => p,
            Err(err) => {
                return GetResult::ParseErr(err);
            }
        };

        let value = MapEntry {
            root: parsed.root,
            // SAFETY: `source.path` borrows `key`, which the entry keeps beside it.
            // The heap address is stable across the move into the map.
            source: unsafe { source.into_static() },
            indentation: parsed.indentation,
            indentation_guessed: opts.guess_indentation,
            _path_storage: key,
            stale_contents: Vec::new(),
            save_arena: AstArena::borrowing_default(),
        };

        bun_core::handle_oom(self.map.put(path, value));
        GetResult::Entry(self.map.get_mut(path).unwrap())
    }
}

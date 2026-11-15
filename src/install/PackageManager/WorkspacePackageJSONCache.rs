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
use bun_resolver::fs::{ByteOrderMark, read_file_contents_in_arena};
use bun_sys::{Fd, File, O};

use crate::bun_json as json;

pub struct MapEntry<'a> {
    pub root: Expr<'a>,
    pub source: &'a Source<'a>,
    pub indentation: Indentation,
    indentation_guessed: bool,
    /// See [`WorkspacePackageJSONCache::mark_stale`].
    stale: bool,
    arena: &'a AstArena,
}

impl<'a> MapEntry<'a> {
    /// `root` as the text of a package.json, in the entry's indentation. Allocated in `arena`.
    pub(crate) fn print(&self, root: Expr<'a>) -> Result<&'a [u8], js_printer::Error> {
        let mut buffer_writer = js_printer::BufferWriter::init();
        buffer_writer
            .buffer
            .list
            .reserve(self.source.contents.len() + 1);
        buffer_writer.append_newline = self.source.contents.last() == Some(&b'\n');
        let mut writer = js_printer::BufferPrinter::init(buffer_writer);
        js_printer::print_json(
            &mut writer,
            self.arena,
            root,
            self.source,
            js_printer::PrintJsonOptions {
                indent: self.indentation,
                mangled_props: None,
                ..Default::default()
            },
        )?;
        let printed = writer.ctx.written_without_trailing_zero();
        Ok(self.arena.dupe_str(printed).slice())
    }

    /// Replaces the text and the tree together: prints `root`, then parses what it printed.
    pub fn save(&mut self, root: Expr<'a>, log: &Log) -> Result<(), Error> {
        let printed = Source::init_path_string(self.source.path.text, self.print(root)?);
        let printed = self.arena.alloc_node(printed).get();
        self.root = parse_package_json(printed, log, self.arena, false)?.root;
        self.source = printed;
        Ok(())
    }
}

type Map<'a> = StringHashMap<MapEntry<'a>>;

fn parse_package_json<'a>(
    source: &'a Source<'_>,
    log: &Log,
    bump: &'a AstArena,
    guess_indentation: bool,
) -> Result<json::JsonResult<'a>, crate::Error> {
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

pub enum GetResult<'a, 'ast> {
    Entry(&'a mut MapEntry<'ast>),
    ReadErr(Error),
    ParseErr(Error),
}

impl<'a, 'ast> GetResult<'a, 'ast> {
    pub(crate) fn unwrap(self) -> Result<&'a mut MapEntry<'ast>, Error> {
        match self {
            GetResult::Entry(entry) => Ok(entry),
            GetResult::ReadErr(err) => Err(err),
            GetResult::ParseErr(err) => Err(err),
        }
    }
}

pub struct WorkspacePackageJSONCache<'a> {
    map: Map<'a>,
    /// Holds the path, the text and the tree of every entry.
    pub(crate) arena: &'a AstArena,
}

impl<'a> WorkspacePackageJSONCache<'a> {
    pub(crate) fn new(arena: &'a AstArena) -> Self {
        Self {
            map: Map::default(),
            arena,
        }
    }

    /// The next lookup of each entry reads its file again, and keeps the entry if the text is the same.
    pub fn mark_stale(&mut self) {
        for entry in self.map.values_mut() {
            entry.stale = true;
        }
    }

    /// Given an absolute path to a workspace package.json, return the AST
    /// and contents of the file. If the package.json is not present in the
    /// cache, it will be read from disk and parsed, and stored in the cache.
    pub fn get_with_path(
        &mut self,
        log: &Log,
        abs_package_json_path: &[u8],
        opts: GetJSONOptions,
    ) -> GetResult<'_, 'a> {
        self.get_or_insert(log, abs_package_json_path, opts, None)
    }

    /// `contents` is the text of a package.json that's never written to disk (`bun add --dry-run`).
    pub(crate) fn insert_unwritten(
        &mut self,
        log: &Log,
        abs_package_json_path: &[u8],
        contents: &'a [u8],
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
        mut contents: Option<&'a [u8]>,
    ) -> GetResult<'_, 'a> {
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

        let arena = self.arena;

        // reshaped for borrowck — we cannot hold an entry borrow across
        // `self.map.remove`, so check
        // membership up front and only insert into the map after a successful
        // read+parse. Net map state is identical on every path.
        if self.map.contains_key(path) {
            let entry = self.map.get_mut(path).unwrap();
            if entry.stale {
                match File::read_from(Fd::cwd(), path) {
                    Ok(on_disk) if on_disk == *entry.source.contents => entry.stale = false,
                    Ok(on_disk) => contents = Some(arena.alloc_slice_copy(&on_disk)),
                    Err(err) => return GetResult::ReadErr(err.into()),
                }
            }
            if !entry.stale {
                if opts.guess_indentation && !entry.indentation_guessed {
                    entry.indentation = json::guess_indentation(&entry.source.contents);
                    entry.indentation_guessed = true;
                }
                return GetResult::Entry(self.map.get_mut(path).unwrap());
            }
        }

        let contents = match contents {
            Some(contents) => contents,
            None => match File::openat(Fd::cwd(), path, O::RDONLY, 0)
                .map_err(bun_resolver::Error::from)
                .and_then(|file| read_file_contents_in_arena(&file, arena, ByteOrderMark::Kept))
            {
                Ok(contents) => contents,
                Err(bun_resolver::Error::Sys(errno)) => return GetResult::ReadErr(errno.into()),
                Err(err) => return GetResult::ReadErr(err.into()),
            },
        };
        let source = Source::init_path_string(arena.dupe_str(path).slice(), contents);
        let source = arena.alloc_node(source).get();

        let parsed = match parse_package_json(source, log, arena, opts.guess_indentation) {
            Ok(p) => p,
            Err(err) => {
                return GetResult::ParseErr(err);
            }
        };

        let value = MapEntry {
            root: parsed.root,
            source,
            indentation: parsed.indentation,
            indentation_guessed: opts.guess_indentation,
            stale: false,
            arena,
        };

        bun_core::handle_oom(self.map.put(path, value));
        GetResult::Entry(self.map.get_mut(path).unwrap())
    }
}

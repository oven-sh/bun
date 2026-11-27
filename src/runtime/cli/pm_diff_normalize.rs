//! Canonical re-printing for `bun pm diff`: parse a JS/CSS/JSON file and print it back in one fixed style so that
//! formatting-only releases collapse to nothing and minified bundles become line-diffable.

use super::pm_diff_command::Threads;
use bun_alloc::Arena;
use bun_ast::Symbol;
use core::cell::Cell;
use core::cmp::Ordering;
use core::ops::Range;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::mpsc;

/// One source-map point: printed (line, col) came from original (line, col); all 0-based.
#[derive(Clone, Copy)]
pub(crate) struct MapPoint {
    pub gen_line: u32,
    pub gen_col: u32,
    pub orig_line: u32,
    pub orig_col: u32,
}

pub(crate) struct Normalized {
    pub text: Vec<u8>,
    /// Every source-map point in printed order. Empty for CSS and JSON, and without `Options::source_map`.
    pub map: Vec<MapPoint>,
    /// `import`/`require` specifiers, in source order, internal/unused ones dropped.
    pub imports: Vec<Vec<u8>>,
    /// The original had so few newlines relative to its size that original line numbers are meaningless.
    pub was_minified: bool,
}

#[derive(Clone, Copy)]
pub(crate) enum Kind {
    Js(bun_ast::Loader),
    Css,
    Json,
}

bun_core::comptime_string_map! {
    static KINDS: Kind = {
        // Plenty of packages ship JSX in `.js`; the JSX loader is a superset.
        b"js" => Kind::Js(bun_ast::Loader::Jsx),
        b"mjs" => Kind::Js(bun_ast::Loader::Jsx),
        b"cjs" => Kind::Js(bun_ast::Loader::Jsx),
        b"jsx" => Kind::Js(bun_ast::Loader::Jsx),
        b"ts" => Kind::Js(bun_ast::Loader::Ts),
        b"mts" => Kind::Js(bun_ast::Loader::Ts),
        b"cts" => Kind::Js(bun_ast::Loader::Ts),
        b"tsx" => Kind::Js(bun_ast::Loader::Tsx),
        b"css" => Kind::Css,
        b"json" => Kind::Json,
    };
}

pub(crate) fn kind_for(path: &[u8]) -> Option<Kind> {
    let ext = &path[bun_core::strings::last_index_of_char(path, b'.')? + 1..];
    // `.d.ts` carries no statements; re-printing it yields an empty file.
    if path.ends_with(b".d.ts") || path.ends_with(b".d.mts") || path.ends_with(b".d.cts") {
        return None;
    }
    KINDS.get(ext).copied()
}

pub(crate) const MAX_BYTES: usize = 64 * 1024 * 1024;

/// How hard to normalise before comparing.
#[derive(Clone, Copy, Default)]
pub(crate) struct Options {
    /// Fold equivalent syntax too (`!0`/`true`, quote style, redundant parens), not only layout.
    pub minify_syntax: bool,
    /// Drop unreachable code, so a branch that became dead reads as a change where it happened.
    pub dce: bool,
    /// One declaration / call per line: undo `var a, b, c` and `a(), b()` chains (the un-minified display).
    pub relayout: bool,
    /// Fill `Normalized::map` (JS only).
    pub source_map: bool,
}

impl Options {
    /// For the comparison key of readable files: as aggressive as the printer gets without renaming.
    pub(crate) const KEY: Options = Options {
        minify_syntax: true,
        dce: true,
        relayout: false,
        source_map: true,
    };

    pub(crate) const fn without_source_map(self) -> Options {
        Options {
            source_map: false,
            ..self
        }
    }
}

pub(crate) fn normalize(path: &[u8], bytes: &[u8], options: Options) -> Option<Normalized> {
    if bytes.len() > MAX_BYTES {
        return None;
    }
    let mut out = match kind_for(path)? {
        Kind::Js(loader) => {
            let printed = {
                let _store = StoreScope::enter();
                let arena = Arena::new();
                let source = bun_ast::Source::init_path_string(path, bytes);
                let mut ast = parse_js(&arena, &source, loader, options)?;
                let symbols = take_symbols(&mut ast);
                print_js(&arena, ast, symbols, &source, options)
            };
            printed.map(|printed| printed.decode(bytes))
        }
        Kind::Css => normalize_css(bytes),
        Kind::Json => normalize_json(path, bytes),
    }?;
    out.was_minified = looks_minified(bytes);
    Some(out)
}

pub(crate) enum Pair {
    Renamed {
        old: Normalized,
        new: Normalized,
        /// The names that were not renamed, such as those of globals and exports, sorted.
        as_written: Vec<Vec<u8>>,
    },
    /// What `normalize` returns for each side, except that `old` may be `None` if `new` is.
    Apart {
        old: Option<Normalized>,
        new: Option<Normalized>,
    },
}

/// What to do with two sides whose locals cannot be renamed.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Otherwise {
    PrintApart,
    /// Both sides of `Pair::Apart` are `None`.
    GiveUp,
}

/// Both sides of a minified JS file, re-printed with mangled locals renamed in lockstep (see [`Namer`]).
pub(crate) fn normalize_minified_pair(
    path: &[u8],
    old: &[u8],
    new: &[u8],
    options: Options,
    threads: Threads,
) -> Pair {
    let (all_names, otherwise) = (false, Otherwise::PrintApart);
    let threads = Some(threads);
    print_pair(path, old, new, [options; 2], all_names, otherwise, threads)
}

/// Both sides of a readable JS file printed as the comparison key: aggressive options plus every local renamed
/// in lockstep, so a bundler's `utils` → `utils$1` (or any consistent rename) is not a difference. Never displayed.
/// `options` are `Options::KEY`, with or without a source map.
pub(crate) fn normalize_key_pair(
    path: &[u8],
    old: &[u8],
    new: &[u8],
    options: Options,
    otherwise: Otherwise,
    threads: Threads,
) -> Pair {
    let (all_names, threads) = (true, Some(threads));
    print_pair(path, old, new, [options; 2], all_names, otherwise, threads)
}

/// The two `options` may differ only in `source_map`. On one thread, `new` is parsed first.
fn print_pair(
    path: &[u8],
    old: &[u8],
    new: &[u8],
    options: [Options; 2],
    all_names: bool,
    otherwise: Otherwise,
    threads: Option<Threads>,
) -> Pair {
    let prints_apart = otherwise == Otherwise::PrintApart;
    let one_by_one = || Pair::Apart {
        old: prints_apart
            .then(|| normalize(path, old, options[0]))
            .flatten(),
        new: prints_apart
            .then(|| normalize(path, new, options[1]))
            .flatten(),
    };
    let fits = old.len().max(new.len()) <= MAX_BYTES;
    let Some(Kind::Js(loader)) = kind_for(path).filter(|_| fits) else {
        return one_by_one();
    };
    let names = Arena::new();
    let as_written = Cell::new(None);
    let not_renamed = |side: Locals| prints_apart.then_some(side.symbols);
    let symbols_for = |o: Locals, n: Locals| {
        if o.nesting.max(n.nesting) > MAX_NESTING {
            return [o, n].map(not_renamed);
        }
        let mut namer = Namer::new(&names, [o, n], all_names);
        namer.plan(Some(0), Some(0), 0);
        as_written.set(Some(namer.taken));
        namer.sides.map(|side| Some(side.symbols))
    };
    let on_two_threads = |threads: Threads| {
        let ((send_locals, locals), (send_symbols, symbols)) = (mpsc::channel(), mpsc::channel());
        threads.try_join(
            old.len().min(new.len()),
            || {
                let store = StoreScope::enter();
                let printed = print_with(path, old, loader, options[0], |o| {
                    let [o, n] = symbols_for(o, locals.recv().ok()?);
                    send_symbols.send(n).ok()?;
                    o
                });
                drop(store);
                let printed = printed.map(|printed| printed.decode(old));
                // If `old` is not parsed, the other thread still waits for its symbols. Otherwise this waits for it to end.
                if let Ok(n) = locals.recv() {
                    let _ = send_symbols.send(not_renamed(n));
                }
                printed
            },
            // Drops `send_locals` when it ends, which ends a wait for them.
            move || {
                let store = StoreScope::enter();
                let printed = print_with(path, new, loader, options[1], |n| {
                    send_locals.send(n).ok()?;
                    symbols.recv().ok()?
                });
                drop(store);
                printed.map(|printed| printed.decode(new))
            },
        )
    };
    let on_this_thread = || {
        let store = StoreScope::enter();
        let mut printed_o = None;
        let printed_n = print_with(path, new, loader, options[1], |n| {
            let (mut n, mut symbols_n) = (Some(n), None);
            printed_o = print_with(path, old, loader, options[0], |o| {
                let [o, n] = symbols_for(o, n.take()?);
                symbols_n = n;
                o
            });
            symbols_n.or_else(|| n.and_then(not_renamed))
        });
        drop(store);
        (
            printed_o.map(|printed| printed.decode(old)),
            printed_n.map(|printed| printed.decode(new)),
        )
    };
    let (o, n) = threads
        .and_then(on_two_threads)
        .unwrap_or_else(on_this_thread);
    let apart = |print: Option<Normalized>, bytes: &[u8]| {
        print.map(|print| Normalized {
            was_minified: looks_minified(bytes),
            ..print
        })
    };
    match (o, n, as_written.into_inner()) {
        (Some(old), Some(new), Some(as_written)) => Pair::Renamed {
            old,
            new,
            as_written,
        },
        (o, n, None) => Pair::Apart {
            old: apart(o, old),
            new: apart(n, new),
        },
        // The printer gave up after the symbols were renamed.
        _ => one_by_one(),
    }
}

/// Parses a file, and prints it with the symbols that `symbols_for` returns.
fn print_with(
    path: &[u8],
    bytes: &[u8],
    loader: bun_ast::Loader,
    options: Options,
    symbols_for: impl FnOnce(Locals) -> Option<Vec<Symbol>>,
) -> Option<Printed> {
    let arena = Arena::new();
    let source = bun_ast::Source::init_path_string(path, bytes);
    let mut ast = parse_js(&arena, &source, loader, options)?;
    let symbols = symbols_for(Locals::take_from(&mut ast))?;
    print_js(&arena, ast, symbols, &source, options)
}

/// Returns true if `old` and `shown` have the same comparison key, which makes them the same
/// program apart from layout and the names of locals.
///
/// `removed` lists the lines of `shown` (0-based, ascending) that the diff marks as removed. A name
/// mismatch there is accepted, because such a line may still use a local's old name.
pub(crate) fn same_program(path: &[u8], old: &[u8], shown: &[u8], removed: &[u32]) -> bool {
    // No second thread, so that `old` is not parsed if `shown` fails to parse.
    same_key(path, old, shown, removed, Options::KEY, None)
}

fn same_key(
    path: &[u8],
    old: &[u8],
    shown: &[u8],
    removed: &[u32],
    options: Options,
    threads: Option<Threads>,
) -> bool {
    let options = [options.without_source_map(), options];
    let (all_names, otherwise) = (true, Otherwise::GiveUp);
    let Pair::Renamed {
        old,
        new: shown,
        as_written,
    } = print_pair(path, old, shown, options, all_names, otherwise, threads)
    else {
        return false;
    };
    let (a, b) = (old.text.as_slice(), shown.text.as_slice());
    let in_name = |c: u8| c.is_ascii_alphanumeric() || c == b'_' || c == b'$' || c >= 0x80;
    let name_end =
        |text: &[u8], at: usize| at + text[at..].iter().take_while(|c| in_name(**c)).count();
    let (mut i, mut j) = (0, 0);
    // The line of `b` that `j` is on, and the offset in `b` where that line starts.
    let (mut line, mut line_start) = (0u32, 0);
    // From `line_start` up to here the line is known to be ASCII.
    let mut ascii_to = 0;
    loop {
        let same_from = j;
        while i < a.len() && j < b.len() && a[i] == b[j] {
            if b[j] == b'\n' {
                line += 1;
                line_start = j + 1;
            }
            i += 1;
            j += 1;
        }
        if i == a.len() && j == b.len() {
            return true;
        }
        // If the texts diverge in the middle of a name, back up to where the name starts.
        while j > same_from && in_name(b[j - 1]) {
            i -= 1;
            j -= 1;
        }
        let (a_end, b_end) = (name_end(a, i), name_end(b, j));
        let at = (line, (j - line_start) as u32);
        let first = shown.map.partition_point(|m| (m.gen_line, m.gen_col) < at);
        let mut from = shown.map[first..]
            .iter()
            .take_while(|m| (m.gen_line, m.gen_col) == at)
            .peekable();
        let let_through = a_end > i
            && b_end > j
            && as_written.binary_search_by(|name| name.as_slice().cmp(&b[j..b_end])).is_ok()
            // The map counts columns in UTF-16 units, which only equal bytes after ASCII text.
            && b[line_start.max(ascii_to)..j].is_ascii()
            && from.peek().is_some()
            && from.all(|m| removed.binary_search(&m.orig_line).is_ok());
        if !let_through {
            return false;
        }
        ascii_to = j;
        (i, j) = (a_end, b_end);
    }
}

/// Returns true if `shown`, which is displayed in place of a file, still parses as that file.
/// `print` is what `normalize` returns for the file with `options`.
pub(crate) fn stands_for(path: &[u8], print: &Normalized, shown: &[u8], options: Options) -> bool {
    normalize(path, shown, options.without_source_map())
        .is_some_and(|again| again.text == print.text)
}

/// Like `stands_for`, for a re-print of the file `raw` in which locals are renamed.
pub(crate) fn stands_for_renamed(
    path: &[u8],
    raw: &[u8],
    shown: &[u8],
    options: Options,
    threads: Threads,
) -> bool {
    same_key(
        path,
        raw,
        shown,
        &[],
        options.without_source_map(),
        Some(threads),
    )
}

/// Most of the file's bytes sit on very long lines (a banner comment or a trailing source-map line aside).
pub(crate) fn looks_minified(bytes: &[u8]) -> bool {
    let long: usize = bun_core::strings::split(bytes, b"\n")
        .map(<[u8]>::len)
        .filter(|&l| l > 256)
        .sum();
    bytes.len() > 256 && long * 2 > bytes.len()
}

/// The parser allocates AST nodes and vectors from thread-local stores; keep them alive in this scope. Its end frees
/// the stores, so scopes must not nest.
struct StoreScope(bun_ast::StoreAstAllocHeap);
impl StoreScope {
    fn enter() -> StoreScope {
        bun_ast::expr::data::Store::create();
        bun_ast::stmt::data::Store::create();
        StoreScope(bun_ast::StoreAstAllocHeap::new())
    }
}
impl Drop for StoreScope {
    fn drop(&mut self) {
        // A reset would keep their memory.
        bun_ast::expr::data::Store::deinit();
        bun_ast::stmt::data::Store::deinit();
    }
}

fn parse_js<'a>(
    arena: &'a Arena,
    source: &'a bun_ast::Source<'a>,
    loader: bun_ast::Loader,
    options: Options,
) -> Option<Box<bun_ast::Ast<'a>>> {
    let mut opts = bun_js_parser::ParserOptions::init(Default::default(), loader);
    // Print what is there: no dead-code removal, no macro execution, no import trimming.
    opts.features.dead_code_elimination = options.dce;
    opts.features.no_macros = true;
    opts.features.trim_unused_imports = false;
    opts.features.minify_syntax = options.minify_syntax;
    // A call marked `@__PURE__` still runs unless a bundler removes it, so it is not dead code.
    opts.ignore_dce_annotations = true;
    opts.keep_directives = true;
    // Accept the same syntax as the runtime.
    opts.features.top_level_await = true;
    opts.features.standard_decorators = !loader.is_typescript();
    opts.transform_only = true;
    opts.suppress_warnings_about_weird_code = true;
    let define: &'a bun_js_parser::Define = arena.alloc(bun_js_parser::Define::default());
    let mut log = bun_ast::Log::init();
    let parser = bun_js_parser::Parser::init(opts, &mut log, source, define, arena).ok()?;
    let bun_js_parser::Result::Ast(ast) = parser.parse().ok()? else {
        return None;
    };
    (log.errors == 0).then_some(ast)
}

/// In a source map, a lone `\r`, U+2028 and U+2029 also end a line. This maps each such line of
/// `text` to the `\n` line it starts on and its byte offset there. `None` means both counts agree.
fn newline_lines(text: &[u8]) -> Option<Vec<(u32, u32)>> {
    use bun_core::strings;
    if !strings::contains_char(text, b'\r') && !strings::contains(text, b"\xe2\x80") {
        return None;
    }
    let mut starts = vec![(0, 0)];
    let (mut line, mut line_start) = (0u32, 0);
    let mut i = 0;
    while i < text.len() {
        let ends_a_line = match text[i] {
            b'\n' => 1,
            b'\r' if text.get(i + 1) == Some(&b'\n') => 2,
            b'\r' => 1,
            0xe2 if matches!(text.get(i + 1..i + 3), Some(b"\x80\xa8" | b"\x80\xa9")) => 3,
            _ => 0,
        };
        i += ends_a_line.max(1);
        if ends_a_line == 0 {
            continue;
        }
        if text[i - 1] == b'\n' {
            line += 1;
            line_start = i;
        }
        starts.push((line, (i - line_start) as u32));
    }
    Some(starts)
}

fn take_symbols(ast: &mut bun_ast::Ast<'_>) -> Vec<Symbol> {
    let arena = *ast.symbols.allocator();
    core::mem::replace(&mut ast.symbols, bun_alloc::ArenaVec::new_in(arena))
        .into_iter()
        .collect()
}

/// A print whose source map is still encoded, which keeps it small until the AST is freed.
struct Printed {
    text: Vec<u8>,
    map: Option<bun_sourcemap::Chunk>,
    imports: Vec<Vec<u8>>,
    hashbang: Vec<u8>,
}

fn print_js<'a>(
    arena: &'a Arena,
    mut ast: Box<bun_ast::Ast<'a>>,
    symbols: Vec<Symbol>,
    source: &'a bun_ast::Source<'a>,
    options: Options,
) -> Option<Printed> {
    super::pm_diff_relayout::relayout(arena, &mut ast, options.relayout);
    let imports: Vec<Vec<u8>> = ast
        .import_records
        .as_slice()
        .iter()
        .filter(|r| {
            !r.flags.intersects(
                bun_ast::ImportRecordFlags::IS_INTERNAL | bun_ast::ImportRecordFlags::IS_UNUSED,
            )
        })
        .map(|r| r.path.text.to_vec())
        .collect();

    let chunk = Cell::new(None);
    let mut printer = bun_js_printer::BufferPrinter::init(bun_js_printer::BufferWriter::init());
    let symbols = bun_ast::symbol::Map::init_with_one_list(symbols);
    let print_opts = bun_js_printer::Options {
        minify_syntax: options.minify_syntax,
        omit_empty_new_parens: true,
        require_ref: Some(ast.require_ref),
        import_meta_ref: ast.import_meta_ref,
        source_map_handler: Some(&chunk),
        mangled_props: None,
        ..Default::default()
    };
    let print_ast = if options.source_map {
        bun_js_printer::print_ast::<false, true>
    } else {
        bun_js_printer::print_ast::<false, false>
    };
    print_ast(&mut printer, arena, &ast, symbols, source, print_opts).ok()?;
    Some(Printed {
        text: printer.ctx.buffer.list,
        map: chunk.into_inner(),
        imports,
        hashbang: ast.hashbang.slice().to_vec(),
    })
}

impl Printed {
    /// `source` is the text that was parsed.
    fn decode(self, source: &[u8]) -> Normalized {
        let Printed {
            mut text,
            map: chunk,
            imports,
            hashbang,
        } = self;
        let mut map = Vec::new();
        if let Some(chunk) = &chunk {
            let (printed, original) = (newline_lines(&text), newline_lines(source));
            let place = |lines: &Option<Vec<(u32, u32)>>, line: i32, col: i32| {
                let (line, col) = (line as u32, col.max(0) as u32);
                match lines.as_ref().and_then(|lines| lines.get(line as usize)) {
                    Some(&(line, start)) => (line, start + col),
                    None => (line, col),
                }
            };
            if let Ok(parsed) = bun_sourcemap::mapping::parse(
                chunk.buffer.list.as_slice(),
                None,
                1,
                bun_sourcemap::mapping::ParseOptions {
                    allow_names: false,
                    sort: true,
                },
            ) {
                let (from, to) = (parsed.mappings.original(), parsed.mappings.generated());
                map.reserve(to.len());
                for (g, o) in to.iter().zip(from) {
                    if g.lines.zero_based() >= 0 && o.lines.zero_based() >= 0 {
                        let (gen_line, gen_col) =
                            place(&printed, g.lines.zero_based(), g.columns.zero_based());
                        let (orig_line, orig_col) =
                            place(&original, o.lines.zero_based(), o.columns.zero_based());
                        map.push(MapPoint {
                            gen_line,
                            gen_col,
                            orig_line,
                            orig_col,
                        });
                    }
                }
            }
        }
        // The printer leaves the hashbang to its caller. The hashbang decides what runs the file, so it
        // is kept as the first line of the output.
        if !hashbang.is_empty() {
            text = [&hashbang, b"\n".as_slice(), text.as_slice()].concat();
            for point in &mut map {
                point.gen_line += 1;
            }
            if chunk.is_some() {
                map.insert(
                    0,
                    MapPoint {
                        gen_line: 0,
                        gen_col: 0,
                        orig_line: 0,
                        orig_col: 0,
                    },
                );
            }
        }
        Normalized {
            text,
            map,
            imports,
            was_minified: false,
        }
    }
}

/// Renames short (mangled-looking) locals on both sides of a diff so that the same code prints with the same names.
///
/// A name is `<letters for the symbol's index in its scope><scope depth>`, so nothing inner can capture something
/// outer and sibling scopes are independent. Within a scope the two sides are aligned (LCS on symbol kind + use
/// count) and matched symbols share an index, so inserting a function does not renumber everything after it.
struct Namer<'s> {
    /// Holds the new names of both sides.
    names: &'s Arena,
    sides: [Locals; 2],
    /// Per side, per symbol: `candidates` has returned it, so no other scope names it too.
    listed: [Vec<bool>; 2],
    /// Every name that is not renamed, such as a global or a long local, sorted. A renamed local is
    /// never given one of these names.
    taken: Vec<Vec<u8>>,
    /// The name for each index and depth that has one.
    given: BTreeMap<(usize, usize), bun_ast::StoreStr>,
    scratch: Vec<u8>,
    /// Rename every local (the comparison key), not only mangled-looking ones (the un-minified display).
    all_names: bool,
}

/// `Namer::plan` recurses once per level, so locals are not renamed in files that nest deeper.
const MAX_NESTING: u32 = 256;

/// What `Namer` needs of one side. The strings in `symbols` live as long as the AST.
struct Locals {
    symbols: Vec<Symbol>,
    /// Per symbol: name-free use-site profile hash (0 = unused / not computed).
    profiles: Vec<u64>,
    scopes: Vec<FlatScope>,
    /// The symbols that each scope declares, in source order. See `FlatScope::members`.
    members: Vec<u32>,
    /// 0 if the module's scope is the only one.
    nesting: u32,
    /// Exports, which are the module's interface, and what direct eval reads by name. The parser only sees to that in
    /// nested scopes.
    pinned: Vec<u32>,
}

impl Locals {
    fn take_from(ast: &mut bun_ast::Ast<'_>) -> Locals {
        let (scopes, members, nesting) = flatten(&ast.module_scope);
        let exports = ast.named_exports.values().iter();
        let mut pinned: Vec<u32> = exports.map(|export| export.ref_.inner_index()).collect();
        if ast.module_scope.contains_direct_eval {
            pinned.extend((ast.module_scope.members.values()).map(|it| it.ref_.inner_index()));
        }
        Locals {
            pinned,
            profiles: super::pm_diff_profile::profiles(ast, ast.symbols.len()),
            symbols: take_symbols(ast),
            scopes,
            members,
            nesting,
        }
    }
}

#[derive(Clone, Copy)]
struct Candidate {
    symbol: usize,
    kind: u8,
    /// kind + bucketed use count: hub symbols keep their bucket when a release adds a call site or two.
    fingerprint: u64,
    /// How the symbol is used (properties read, call arities, …); 0 when unknown.
    profile: u64,
    /// The spelling, used only to break ties between structurally identical candidates.
    name_hash: u64,
}

fn count_bucket(n: u32) -> u64 {
    if n < 6 {
        u64::from(n)
    } else {
        6 + u64::from((n / 3).ilog2())
    }
}

impl<'s> Namer<'s> {
    fn new(names: &'s Arena, mut sides: [Locals; 2], all_names: bool) -> Namer<'s> {
        // The printer reads this flag too, so only renamed sides get it.
        for side in &mut sides {
            for &pinned in &side.pinned {
                let symbol = Self::root(&side.symbols, pinned as usize);
                side.symbols[symbol].set_must_not_be_renamed(true);
            }
        }
        // Locals the parser pinned (direct eval, `with`) keep their names, as globals do.
        let mut taken: Vec<&[u8]> = sides
            .iter()
            .flat_map(|side| &side.symbols)
            .filter(|sym| {
                sym.slot_namespace() == bun_ast::symbol::SlotNamespace::MustNotBeRenamed
                    || (!all_names && sym.original_name.len() > 2)
            })
            .map(|sym| sym.original_name.slice())
            .collect();
        taken.sort_unstable();
        taken.dedup();
        Namer {
            names,
            all_names,
            listed: sides.each_ref().map(|side| vec![false; side.symbols.len()]),
            taken: taken.into_iter().map(<[u8]>::to_vec).collect(),
            sides,
            given: BTreeMap::new(),
            scratch: Vec::new(),
        }
    }

    fn root(symbols: &[Symbol], mut i: usize) -> usize {
        for _ in 0..64 {
            let link = symbols[i].link.get();
            if !link.is_valid() || link.is_source_contents_slice() {
                break;
            }
            i = link.inner_index() as usize;
        }
        i
    }

    /// Members of `scope` on `side` that should get positional names, in source order.
    fn candidates(&mut self, side: usize, scope: u32) -> Vec<Candidate> {
        let Locals {
            symbols,
            profiles,
            scopes,
            members,
            ..
        } = &self.sides[side];
        let Range { start, end } = scopes[scope as usize].members;
        let members = &members[start as usize..end as usize];
        let mut out = Vec::with_capacity(members.len());
        for &inner in members {
            let i = Self::root(symbols, inner as usize);
            let sym = &symbols[i];
            if self.listed[side][i]
                || (!self.all_names && sym.original_name.len() > 2)
                || sym.slot_namespace() != bun_ast::symbol::SlotNamespace::Default
            {
                continue;
            }
            self.listed[side][i] = true;
            let profile = profiles.get(inner as usize).copied().unwrap_or(0);
            out.push(Candidate {
                symbol: i,
                kind: sym.kind as u8,
                fingerprint: (sym.kind as u64) << 32 | count_bucket(sym.use_count_estimate),
                profile,
                name_hash: bun_wyhash::hash(sym.original_name.slice()),
            });
        }
        out
    }

    fn assign(&mut self, side: usize, symbol: usize, index: usize, depth: usize) {
        let name = match self.given.get(&(index, depth)) {
            Some(&name) => name,
            None => self.new_name(index, depth),
        };
        self.sides[side].symbols[symbol].original_name = name;
    }

    fn new_name(&mut self, index: usize, depth: usize) -> bun_ast::StoreStr {
        const LETTERS: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
        let out = &mut self.scratch;
        out.clear();
        let mut n = index;
        loop {
            out.push(LETTERS[n % LETTERS.len()]);
            n /= LETTERS.len();
            if n == 0 {
                break;
            }
            n -= 1;
        }
        if depth > 0 {
            let _ = std::io::Write::write_fmt(out, format_args!("{depth}"));
        }
        // Keep suffixing until the name is free: `a` taken → `a_`, and `a_` may be taken too.
        while matches!(out.as_slice(), b"do" | b"if" | b"in" | b"of")
            || self.taken.binary_search(out).is_ok()
        {
            out.push(b'_');
        }
        let name = bun_ast::StoreStr::new(self.names.alloc_slice_copy(out));
        self.given.insert((index, depth), name);
        name
    }

    /// `depth` is the naming digit (only scopes that named something bump it).
    fn plan(&mut self, old: Option<u32>, new: Option<u32>, depth: usize) {
        let co = old.map_or(Vec::new(), |s| self.candidates(0, s));
        let cn = new.map_or(Vec::new(), |s| self.candidates(1, s));
        let mut index = 0;
        // Strongest evidence first: identical use-site profile (+kind), then kind + use bucket, then kind alone. The
        // spelling only ever breaks a tie between candidates the structure cannot tell apart.
        let key = |c: &Candidate| {
            if c.profile != 0 {
                (u64::from(c.kind) << 56) ^ c.profile
            } else {
                c.fingerprint
            }
        };
        let mut aligned = align(&co, &cn, key);
        rematch_runs(&mut aligned, &co, &cn, |c| (c.fingerprint, c.name_hash));
        rematch_runs(&mut aligned, &co, &cn, |c| c.fingerprint);
        rematch_runs(&mut aligned, &co, &cn, |c| (c.kind, c.name_hash));
        rematch_runs(&mut aligned, &co, &cn, |c| c.kind);
        for pair in aligned {
            if let (Some(i), _) = pair {
                self.assign(0, co[i].symbol, index, depth);
            }
            if let (_, Some(j)) = pair {
                self.assign(1, cn[j].symbol, index, depth);
            }
            index += 1;
        }
        // Scopes that declare nothing (arg lists, plain blocks) do not use up a depth digit.
        let child_depth = depth + usize::from(index > 0);
        for (o, n) in pair_scopes(
            children(&self.sides[0].scopes, old),
            children(&self.sides[1].scopes, new),
        ) {
            self.plan(o, n, child_depth);
        }
    }
}

/// A scope in a list of a file's scopes, in which the scopes inside it come directly after it.
struct FlatScope {
    /// Its part of `Locals::members`.
    members: Range<u32>,
    kind: bun_ast::scope::Kind,
    /// Its index in the list.
    at: u32,
    /// The index of the scope around it. 0 for the root.
    parent: u32,
    /// The number of scopes in its subtree, itself included.
    scopes: u32,
    /// The number of members in its subtree.
    weight: u32,
}

fn flatten(root: &bun_ast::Scope) -> (Vec<FlatScope>, Vec<u32>, u32) {
    let mut out: Vec<FlatScope> = Vec::new();
    let (mut members, mut own) = (Vec::new(), Vec::new());
    let (mut stack, mut nesting) = (vec![(root, 0, 0)], 0);
    while let Some((scope, parent, level)) = stack.pop() {
        nesting = nesting.max(level);
        let at = out.len() as u32;
        own.extend((scope.members.values()).map(|m| (m.loc.start, m.ref_.inner_index())));
        own.extend(scope.generated.iter().map(|r| (i32::MAX, r.inner_index())));
        own.sort_unstable();
        let start = members.len() as u32;
        members.extend(own.drain(..).map(|(_, symbol)| symbol));
        out.push(FlatScope {
            members: start..members.len() as u32,
            kind: scope.kind,
            at,
            parent,
            scopes: 1,
            weight: scope.members.len() as u32,
        });
        stack.extend(scope.children.iter().rev().map(|c| (&**c, at, level + 1)));
    }
    for at in (1..out.len()).rev() {
        let (scopes, weight) = (out[at].scopes, out[at].weight);
        let parent = out[at].parent as usize;
        out[parent].scopes += scopes;
        out[parent].weight += weight;
    }
    (out, members, nesting)
}

fn children(scopes: &[FlatScope], of: Option<u32>) -> Vec<&FlatScope> {
    let mut out = Vec::new();
    if let Some(of) = of {
        let mut at = of + 1;
        while at < of + scopes[of as usize].scopes {
            let child = &scopes[at as usize];
            out.push(child);
            at += child.scopes;
        }
    }
    out
}

/// Which child scope on the old side is "the same" scope on the new side. Only scopes that declare a lot need a
/// good answer (small ones name positionally either way), so those are matched by kind and closest member count
/// first; the rest are aligned in order by kind and member count, and what that leaves by kind alone.
fn pair_scopes<'a>(
    mut old: Vec<&'a FlatScope>,
    mut new: Vec<&'a FlatScope>,
) -> Vec<(Option<u32>, Option<u32>)> {
    const BIG: u32 = 24;
    let mut out = Vec::new();
    let mut order: Vec<usize> = (0..new.len()).filter(|&j| new[j].weight >= BIG).collect();
    if !order.is_empty() {
        // (kind, weight, index) of each old scope that has no pair yet.
        let mut unpaired: BTreeSet<(u8, u32, usize)> = (0..old.len())
            .filter(|&i| old[i].weight >= BIG / 2)
            .map(|i| (old[i].kind as u8, old[i].weight, i))
            .collect();
        let mut old_used = vec![false; old.len()];
        let mut new_used = vec![false; new.len()];
        // Heaviest first, so the one scope that matters most gets first pick.
        order.sort_by_key(|&j| core::cmp::Reverse(new[j].weight));
        for j in order {
            let (kind, weight) = (new[j].kind as u8, new[j].weight);
            let first = |from, to| unpaired.range((kind, from, 0)..(kind, to, 0)).next();
            let lighter = unpaired.range((kind, 0, 0)..(kind, weight, 0)).next_back();
            // The closest weight is the next lower or the next higher one. Ties go to the earlier scope.
            let best = [
                lighter.and_then(|&(_, lighter, _)| first(lighter, weight)),
                first(weight, u32::MAX),
            ]
            .into_iter()
            .flatten()
            .min_by_key(|&&(_, other, i)| (other.abs_diff(weight), i));
            if let Some(&best @ (_, other, i)) = best
                && other.abs_diff(weight) * 2 <= weight
            {
                unpaired.remove(&best);
                old_used[i] = true;
                new_used[j] = true;
                out.push((Some(old[i].at), Some(new[j].at)));
            }
        }
        for (scopes, used) in [(&mut old, old_used), (&mut new, new_used)] {
            let mut used = used.into_iter();
            scopes.retain(|_| used.next() == Some(false));
        }
    }
    let mut rest = align(&old, &new, |s| (s.kind as u64) << 32 | u64::from(s.weight));
    rematch_runs(&mut rest, &old, &new, |s| s.kind as u8);
    out.extend(
        rest.into_iter()
            .map(|(i, j)| (i.map(|i| old[i].at), j.map(|j| new[j].at))),
    );
    out
}

/// Between two matched anchors, leftovers whose fingerprint drifted (a use count crossed a bucket) are still
/// almost certainly the same symbols; pair off those with the same `key` in order.
fn rematch_runs<T, K: Ord>(
    aligned: &mut Vec<(Option<usize>, Option<usize>)>,
    a: &[T],
    b: &[T],
    key: impl Fn(&T) -> K,
) {
    let is_pair = |p: &(Option<usize>, Option<usize>)| p.0.is_some() && p.1.is_some();
    if aligned.iter().all(is_pair) {
        return;
    }
    let mut out = Vec::with_capacity(aligned.len());
    for run in aligned.chunk_by(|x, y| is_pair(x) == is_pair(y)) {
        if run.iter().all(|p| p.0.is_some()) || run.iter().all(|p| p.1.is_some()) {
            out.extend_from_slice(run);
            continue;
        }
        let mut olds: Vec<usize> = run.iter().filter_map(|p| p.0).collect();
        let mut news: Vec<usize> = run.iter().filter_map(|p| p.1).collect();
        olds.sort_by_key(|&i| key(&a[i]));
        news.sort_by_key(|&j| key(&b[j]));
        let (run_start, mut o, mut n) = (out.len(), 0, 0);
        while o < olds.len() || n < news.len() {
            let order = match (olds.get(o), news.get(n)) {
                (Some(&i), Some(&j)) => key(&a[i]).cmp(&key(&b[j])),
                (Some(_), None) => Ordering::Less,
                (None, _) => Ordering::Greater,
            };
            let (take_old, take_new) = (order.is_le(), order.is_ge());
            out.push((take_old.then(|| olds[o]), take_new.then(|| news[n])));
            o += usize::from(take_old);
            n += usize::from(take_new);
        }
        // The old side's order, then the new side's for what is only there.
        out[run_start..].sort_unstable_by_key(|&(i, j)| (i.is_none(), i, j));
    }
    *aligned = out;
}

/// LCS alignment of two keyed sequences: yields every element of both, matched ones together, in merged order.
fn align<T>(a: &[T], b: &[T], key: impl Fn(&T) -> u64) -> Vec<(Option<usize>, Option<usize>)> {
    let (n, m) = (a.len(), b.len());
    let mut out = Vec::with_capacity(n.max(m));
    // Trim the common head and tail so the quadratic part only sees the churn.
    let head = a
        .iter()
        .zip(b)
        .take_while(|(x, y)| key(x) == key(y))
        .count();
    let tail = a[head..]
        .iter()
        .rev()
        .zip(b[head..].iter().rev())
        .take_while(|(x, y)| key(x) == key(y))
        .count();
    out.extend((0..head).map(|i| (Some(i), Some(i))));
    let (a2, b2) = (&a[head..n - tail], &b[head..m - tail]);
    let (n2, m2) = (a2.len(), b2.len());
    if n2 == 0 || m2 == 0 {
        for k in 0..n2.max(m2) {
            out.push(((k < n2).then_some(head + k), (k < m2).then_some(head + k)));
        }
    } else if n2 * m2 > 4_000_000 {
        // Too big for the table: greedy resync within a window, which is what insert/delete runs need anyway.
        const WINDOW: usize = 96;
        let (mut i, mut j) = (0, 0);
        while i < n2 && j < m2 {
            if key(&a2[i]) == key(&b2[j]) {
                out.push((Some(head + i), Some(head + j)));
                i += 1;
                j += 1;
                continue;
            }
            let da = (1..WINDOW).find(|&d| i + d < n2 && key(&a2[i + d]) == key(&b2[j]));
            let db = (1..WINDOW).find(|&d| j + d < m2 && key(&b2[j + d]) == key(&a2[i]));
            match (da, db) {
                (Some(da), db) if db.is_none_or(|db| da <= db) => {
                    out.extend((i..i + da).map(|k| (Some(head + k), None)));
                    i += da;
                }
                (_, Some(db)) => {
                    out.extend((j..j + db).map(|k| (None, Some(head + k))));
                    j += db;
                }
                _ => {
                    out.push((Some(head + i), None));
                    out.push((None, Some(head + j)));
                    i += 1;
                    j += 1;
                }
            }
        }
        out.extend((i..n2).map(|k| (Some(head + k), None)));
        out.extend((j..m2).map(|k| (None, Some(head + k))));
    } else {
        // Bit-parallel LCS (Crochemore et al., 2001): in row `i`, bit `m2 - 1 - j` is set if `b2[j]` adds nothing to
        // the LCS of `a2[i..]` and `b2[j..]`.
        let words = m2.div_ceil(64);
        let mut keys: Vec<u64> = a2.iter().map(&key).collect();
        keys.sort_unstable();
        keys.dedup();
        let mut places = vec![0u64; keys.len() * words];
        for (j, y) in b2.iter().rev().enumerate() {
            if let Ok(k) = keys.binary_search(&key(y)) {
                places[k * words + j / 64] |= 1 << (j % 64);
            }
        }
        let mut same = vec![!0u64; (n2 + 1) * words];
        for i in (0..n2).rev() {
            let at = keys.partition_point(|&k| k < key(&a2[i])) * words;
            let (row, below) = same[i * words..].split_at_mut(words);
            let mut carry = false;
            for w in 0..words {
                let (sum, c) = below[w].carrying_add(below[w] & places[at + w], carry);
                row[w] = sum | (below[w] & !places[at + w]);
                carry = c;
            }
        }
        let is_same = |i: usize, j: usize| {
            same[i * words + (m2 - 1 - j) / 64] >> ((m2 - 1 - j) % 64) & 1 != 0
        };
        let (mut i, mut j) = (0, 0);
        while i < n2 || j < m2 {
            if i < n2 && j < m2 && key(&a2[i]) == key(&b2[j]) {
                out.push((Some(head + i), Some(head + j)));
                i += 1;
                j += 1;
            } else if j < m2 && is_same(i, j) {
                out.push((None, Some(head + j)));
                j += 1;
            } else {
                out.push((Some(head + i), None));
                i += 1;
            }
        }
    }
    out.extend((0..tail).map(|k| (Some(n - tail + k), Some(m - tail + k))));
    out
}

fn normalize_css(bytes: &[u8]) -> Option<Normalized> {
    let alloc = &Arena::new();
    let mut import_records = Vec::<bun_ast::ImportRecord>::default();
    let (sheet, _extra) = bun_css::StyleSheet::<bun_css::DefaultAtRule>::parse(
        alloc,
        bytes,
        bun_css::ParserOptions::default(None),
        Some(&mut import_records),
        bun_ast::Index::INVALID,
    )
    .ok()?;
    let symbols = bun_ast::symbol::Map::init_list(Default::default());
    let result = sheet
        .to_css(
            alloc,
            &bun_css::PrinterOptions {
                minify: false,
                ..bun_css::PrinterOptions::default()
            },
            Some(bun_css::ImportInfo::init_outside_of_bundler(
                &import_records,
            )),
            None,
            &symbols,
        )
        .ok()?;
    let imports = import_records
        .iter()
        .map(|r| r.path.text.to_vec())
        .collect();
    Some(Normalized {
        text: result.code,
        map: Vec::new(),
        imports,
        was_minified: false,
    })
}

fn normalize_json(path: &[u8], bytes: &[u8]) -> Option<Normalized> {
    let _store = StoreScope::enter();
    let arena = Arena::new();
    let source = bun_ast::Source::init_path_string(path, bytes);
    let expr = bun_parsers::json::parse_utf8(&source, &mut bun_ast::Log::init(), &arena).ok()?;
    let mut writer = bun_js_printer::BufferWriter::init();
    writer.append_newline = true;
    let mut printer = bun_js_printer::BufferPrinter::init(writer);
    bun_js_printer::print_json(
        &mut printer,
        expr,
        &source,
        bun_js_printer::PrintJsonOptions {
            mangled_props: None,
            ..Default::default()
        },
    )
    .ok()?;
    Some(Normalized {
        text: printer.ctx.buffer.list,
        map: Vec::new(),
        imports: Vec::new(),
        was_minified: false,
    })
}

/// Things a reviewer wants called out when they newly appear in a release. Counted on canonical text so formatting cannot hide them.
pub(crate) const SIGNALS: &[(&[u8], &str)] = &[
    (b"eval(", "eval()"),
    (b"eval)(", "eval()"),
    (b"Function(", "Function()"),
    (b"process.env", "process.env"),
    (b"fetch(", "fetch()"),
    (b"XMLHttpRequest", "XMLHttpRequest"),
    (b"WebSocket(", "WebSocket"),
    (b"http://", "http:// URL"),
    (b"https://", "https:// URL"),
];

pub(crate) fn count_signals(text: &[u8]) -> [usize; SIGNALS.len()] {
    let mut out = [0usize; SIGNALS.len()];
    for (i, (needle, _)) in SIGNALS.iter().enumerate() {
        let mut at = 0usize;
        while let Some(pos) = bun_core::strings::index_of(&text[at..], needle) {
            let start = at + pos;
            // `refetch(`/`_eval(` are someone's own function, not the global.
            let own = start > 0
                && matches!(text[start - 1], b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'_' | b'$' | b'.');
            if !own {
                out[i] += 1;
            }
            at = start + needle.len();
        }
    }
    out
}

bun_core::comptime_string_set! {
    static NOTABLE_BUILTINS = {
        b"child_process", b"fs", b"fs/promises", b"net", b"http", b"https", b"http2", b"dgram", b"dns", b"tls",
        b"vm", b"worker_threads", b"os", b"inspector",
    };
}

/// Node builtins whose first appearance in a package deserves a line in the summary.
pub(crate) fn notable_builtin(spec: &[u8]) -> bool {
    NOTABLE_BUILTINS.contains(spec.strip_prefix(b"node:").unwrap_or(spec))
}

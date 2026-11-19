//! Canonical re-printing for `bun pm diff`: parse a JS/CSS/JSON file and print it back in one fixed style so that
//! formatting-only releases collapse to nothing and minified bundles become line-diffable.

use super::pm_diff_command::Threads;
use bun_alloc::Arena;
use bun_ast::Symbol;
use core::cell::Cell;
use core::cmp::Ordering;
use core::ops::Range;
use std::collections::BTreeSet;
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

    const fn without_source_map(self) -> Options {
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
            let _store = StoreScope::enter();
            let arena = Arena::new();
            let source = bun_ast::Source::init_path_string(path, bytes);
            let mut ast = parse_js(&arena, &source, loader, options)?;
            let symbols = take_symbols(&mut ast);
            print_js(&arena, ast, symbols, &source, options)
        }
        Kind::Css => normalize_css(bytes),
        Kind::Json => normalize_json(path, bytes),
    }?;
    out.was_minified = looks_minified(bytes);
    Some(out)
}

/// Both sides of a minified JS file, re-printed with mangled locals renamed in lockstep (see [`Namer`]).
pub(crate) fn normalize_minified_pair(
    path: &[u8],
    old: &[u8],
    new: &[u8],
    options: Options,
    threads: Threads,
) -> Option<(Normalized, Normalized)> {
    let all_names = false;
    let (mut o, mut n, _) = print_pair(path, old, new, [options; 2], all_names, threads)?;
    o.was_minified = true;
    n.was_minified = true;
    Some((o, n))
}

/// Both sides of a readable JS file printed as the comparison key: aggressive options plus every local renamed
/// in lockstep, so a bundler's `utils` → `utils$1` (or any consistent rename) is not a difference. Never displayed.
/// `options` are `Options::KEY`, with or without a source map.
pub(crate) fn normalize_key_pair(
    path: &[u8],
    old: &[u8],
    new: &[u8],
    options: Options,
    threads: Threads,
) -> Option<(Normalized, Normalized)> {
    let all_names = true;
    print_pair(path, old, new, [options; 2], all_names, threads).map(|(o, n, _)| (o, n))
}

/// Returns the two prints and a sorted list of every name in them that was not renamed, such as the
/// names of globals and exports. The two `options` may differ only in `source_map`.
fn print_pair(
    path: &[u8],
    old: &[u8],
    new: &[u8],
    options: [Options; 2],
    all_names: bool,
    threads: Threads,
) -> Option<(Normalized, Normalized, Vec<Vec<u8>>)> {
    /// With less text on either side, starting a thread costs more than it saves.
    const MIN_BYTES_FOR_THREAD: usize = 256 << 10;

    let Some(Kind::Js(loader)) = kind_for(path) else {
        return None;
    };
    if old.len() > MAX_BYTES || new.len() > MAX_BYTES {
        return None;
    }
    let names = Arena::new();
    let as_written = Cell::new(Vec::new());
    let rename = &|o: Locals, n: Locals| {
        let mut namer = Namer::new(&names, [o, n], all_names);
        namer.plan(Some(0), Some(0), 0, 0);
        as_written.set(namer.taken);
        (!namer.too_deep).then_some(namer.sides.map(|side| side.symbols))
    };
    let _store = StoreScope::enter();
    let on_two_threads = || {
        // A side that gives up drops its ends, which makes the other one give up.
        let ((send_locals, locals), (send_renamed, renamed)) = (mpsc::channel(), mpsc::channel());
        threads.join(
            || {
                print_renamed(path, old, loader, options[0], move |o| {
                    let [o, n] = rename(o, locals.recv().ok()?)?;
                    send_renamed.send(n).ok()?;
                    Some(o)
                })
            },
            move || {
                let printed = {
                    let _store = StoreScope::enter();
                    print_renamed(path, new, loader, options[1], |n| {
                        send_locals.send(n).ok()?;
                        renamed.recv().ok()
                    })
                };
                bun_ast::expr::data::Store::deinit();
                bun_ast::stmt::data::Store::deinit();
                printed
            },
        )
    };
    let on_this_thread = || {
        let mut printed_n = None;
        let printed_o = print_renamed(path, old, loader, options[0], |o| {
            let mut renamed_o = None;
            printed_n = print_renamed(path, new, loader, options[1], |n| {
                let [o, n] = rename(o, n)?;
                renamed_o = Some(o);
                Some(n)
            });
            renamed_o
        });
        (printed_o, printed_n)
    };
    let (o, n) = (old.len().min(new.len()) >= MIN_BYTES_FOR_THREAD)
        .then(on_two_threads)
        .flatten()
        .unwrap_or_else(on_this_thread);
    Some((o?, n?, as_written.into_inner()))
}

/// Parses a file, and prints it with the symbols that `rename` returns.
fn print_renamed(
    path: &[u8],
    bytes: &[u8],
    loader: bun_ast::Loader,
    options: Options,
    rename: impl FnOnce(Locals) -> Option<Vec<Symbol>>,
) -> Option<Normalized> {
    let arena = Arena::new();
    let source = bun_ast::Source::init_path_string(path, bytes);
    let mut ast = parse_js(&arena, &source, loader, options)?;
    pin_exports(&mut ast);
    let symbols = rename(Locals::take_from(&mut ast))?;
    print_js(&arena, ast, symbols, &source, options)
}

/// Returns true if `old` and `shown` have the same comparison key, which makes them the same
/// program apart from layout and the names of locals.
///
/// `removed` lists the lines of `shown` (0-based, ascending) that the diff marks as removed. A name
/// mismatch there is accepted, because such a line may still use a local's old name.
pub(crate) fn same_program(
    path: &[u8],
    old: &[u8],
    shown: &[u8],
    removed: &[u32],
    threads: Threads,
) -> bool {
    same_key(path, old, shown, removed, Options::KEY, threads)
}

fn same_key(
    path: &[u8],
    old: &[u8],
    shown: &[u8],
    removed: &[u32],
    options: Options,
    threads: Threads,
) -> bool {
    let options = [options.without_source_map(), options];
    let all_names = true;
    let Some((old, shown, as_written)) = print_pair(path, old, shown, options, all_names, threads)
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
            && b[line_start..j].is_ascii()
            && from.peek().is_some()
            && from.all(|m| removed.binary_search(&m.orig_line).is_ok());
        if !let_through {
            return false;
        }
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
    same_key(path, raw, shown, &[], options.without_source_map(), threads)
}

/// Keeps exported symbols from being renamed. An export's name is part of the module's interface.
fn pin_exports(ast: &mut bun_ast::Ast<'_>) {
    for export in ast.named_exports.values() {
        let symbol = Namer::root(ast.symbols.as_slice(), export.ref_.inner_index() as usize);
        ast.symbols.as_mut_slice()[symbol].set_must_not_be_renamed(true);
    }
}

/// Most of the file's bytes sit on very long lines (a banner comment or a trailing source-map line aside).
pub(crate) fn looks_minified(bytes: &[u8]) -> bool {
    let long: usize = bun_core::strings::split(bytes, b"\n")
        .map(<[u8]>::len)
        .filter(|&l| l > 256)
        .sum();
    bytes.len() > 256 && long * 2 > bytes.len()
}

/// The parser allocates AST nodes and vectors from thread-local stores; keep them alive in this scope. After
/// it, the nodes' stores are reset and the vectors freed.
struct StoreScope(bun_ast::StoreResetGuard, bun_ast::StoreAstAllocHeap);
impl StoreScope {
    fn enter() -> StoreScope {
        bun_ast::expr::data::Store::create();
        bun_ast::stmt::data::Store::create();
        StoreScope(
            bun_ast::StoreResetGuard::new(),
            bun_ast::StoreAstAllocHeap::new(),
        )
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

fn print_js<'a>(
    arena: &'a Arena,
    mut ast: Box<bun_ast::Ast<'a>>,
    symbols: Vec<Symbol>,
    source: &'a bun_ast::Source<'a>,
    options: Options,
) -> Option<Normalized> {
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
    let mut text = printer.ctx.buffer.list;

    let mut map = Vec::new();
    if let Some(chunk) = chunk.into_inner() {
        let (printed, original) = (newline_lines(&text), newline_lines(source.contents()));
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
    let hashbang = ast.hashbang.slice();
    if !hashbang.is_empty() {
        text = [hashbang, b"\n".as_slice(), text.as_slice()].concat();
        for point in &mut map {
            point.gen_line += 1;
        }
        if options.source_map {
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
    Some(Normalized {
        text,
        map,
        imports,
        was_minified: false,
    })
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
    /// A scope was nested too deep to be renamed. Its original names were not checked against the
    /// new names given to the scopes around it, so the renaming cannot be used.
    too_deep: bool,
    scratch: Vec<u8>,
    /// Rename every local (the comparison key), not only mangled-looking ones (the un-minified display).
    all_names: bool,
}

/// What `Namer` needs of one side. The strings in `symbols` live as long as the AST.
struct Locals {
    symbols: Vec<Symbol>,
    /// Per symbol: name-free use-site profile hash (0 = unused / not computed).
    profiles: Vec<u64>,
    scopes: Vec<FlatScope>,
    /// The symbols that each scope declares, in source order. See `FlatScope::members`.
    members: Vec<u32>,
}

impl Locals {
    fn take_from(ast: &mut bun_ast::Ast<'_>) -> Locals {
        let (scopes, members) = flatten(&ast.module_scope);
        Locals {
            profiles: super::pm_diff_profile::profiles(ast, ast.symbols.len()),
            symbols: take_symbols(ast),
            scopes,
            members,
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
    fn new(names: &'s Arena, sides: [Locals; 2], all_names: bool) -> Namer<'s> {
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
            too_deep: false,
            all_names,
            listed: sides.each_ref().map(|side| vec![false; side.symbols.len()]),
            taken: taken.into_iter().map(<[u8]>::to_vec).collect(),
            sides,
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
        self.sides[side].symbols[symbol].original_name =
            bun_ast::StoreStr::new(self.names.alloc_slice_copy(out));
    }

    /// `depth` is the naming digit (only scopes that named something bump it); `level` is the real nesting.
    fn plan(&mut self, old: Option<u32>, new: Option<u32>, depth: usize, level: usize) {
        // `plan` recurses once per nesting level. Input nested deeper than this is pathological, so
        // the callers give up on renaming it.
        if level > 256 {
            self.too_deep = true;
            return;
        }
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
            self.plan(o, n, child_depth, level + 1);
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

fn flatten(root: &bun_ast::Scope) -> (Vec<FlatScope>, Vec<u32>) {
    let mut out: Vec<FlatScope> = Vec::new();
    let (mut members, mut own) = (Vec::new(), Vec::new());
    let mut stack = vec![(root, 0)];
    while let Some((scope, parent)) = stack.pop() {
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
        stack.extend(scope.children.iter().rev().map(|c| (&**c, at)));
    }
    for at in (1..out.len()).rev() {
        let (scopes, weight) = (out[at].scopes, out[at].weight);
        let parent = out[at].parent as usize;
        out[parent].scopes += scopes;
        out[parent].weight += weight;
    }
    (out, members)
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

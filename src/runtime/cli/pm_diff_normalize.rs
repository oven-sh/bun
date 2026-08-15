//! Canonical re-printing for `bun pm diff`: parse a JS/CSS/JSON file and print it back in one fixed style so that
//! formatting-only releases collapse to nothing and minified bundles become line-diffable.

use bun_alloc::Arena;
use bun_core::Ordinal;

pub(crate) struct Normalized {
    pub text: Vec<u8>,
    /// Printed line (0-based index) → original 1-based line, when the printer gave us a source map.
    pub line_map: Vec<u32>,
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
        b"js" => Kind::Js(bun_ast::Loader::Js),
        b"mjs" => Kind::Js(bun_ast::Loader::Js),
        b"cjs" => Kind::Js(bun_ast::Loader::Js),
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

const MAX_BYTES: usize = 8 * 1024 * 1024;

/// How hard to normalise before comparing.
#[derive(Clone, Copy, Default)]
pub(crate) struct Options {
    /// Fold equivalent syntax too (`!0`/`true`, quote style, redundant parens), not only layout.
    pub minify_syntax: bool,
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
            let ast = parse_js(&arena, &source, loader, options)?;
            print_js(&arena, ast, &source, options)
        }
        Kind::Css => normalize_css(path, bytes),
        Kind::Json => normalize_json(path, bytes),
    }?;
    out.was_minified = looks_minified(bytes);
    Some(out)
}

/// Both sides of a minified JS file, re-printed with mangled locals renamed in lockstep (see [`plan_names`]).
pub(crate) fn normalize_minified_pair(
    path: &[u8],
    old: &[u8],
    new: &[u8],
    options: Options,
) -> Option<(Normalized, Normalized)> {
    let Some(Kind::Js(loader)) = kind_for(path) else {
        return None;
    };
    if old.len() > MAX_BYTES || new.len() > MAX_BYTES {
        return None;
    }
    let _store = StoreScope::enter();
    let (arena_o, arena_n) = (Arena::new(), Arena::new());
    let source_o = bun_ast::Source::init_path_string(path, old);
    let source_n = bun_ast::Source::init_path_string(path, new);
    let mut ast_o = parse_js(&arena_o, &source_o, loader, options)?;
    let mut ast_n = parse_js(&arena_n, &source_n, loader, options)?;
    {
        let mut namer = Namer::new(
            &arena_o,
            &arena_n,
            ast_o.symbols.as_mut_slice(),
            ast_n.symbols.as_mut_slice(),
        );
        namer.plan(Some(&ast_o.module_scope), Some(&ast_n.module_scope), 0);
    }
    let mut o = print_js(&arena_o, ast_o, &source_o, options)?;
    let mut n = print_js(&arena_n, ast_n, &source_n, options)?;
    o.was_minified = true;
    n.was_minified = true;
    Some((o, n))
}

fn looks_minified(bytes: &[u8]) -> bool {
    bytes.len() > 256 && bun_core::strings::count_char(bytes, b'\n') * 200 < bytes.len()
}

/// The parser allocates nodes from thread-local stores; keep them alive for the ASTs in this scope, reset after.
struct StoreScope(bun_ast::StoreResetGuard);
impl StoreScope {
    fn enter() -> StoreScope {
        bun_ast::expr::data::Store::create();
        bun_ast::stmt::data::Store::create();
        StoreScope(bun_ast::StoreResetGuard::new())
    }
}

struct ChunkCollector(Option<bun_sourcemap::Chunk>);
impl bun_js_printer::OnSourceMapChunk for ChunkCollector {
    fn on_source_map_chunk(
        &mut self,
        chunk: bun_sourcemap::Chunk,
        _: &bun_ast::Source,
    ) -> bun_js_printer::Result<()> {
        self.0 = Some(chunk);
        Ok(())
    }
}

fn parse_js<'a>(
    arena: &'a Arena,
    source: &'a bun_ast::Source,
    loader: bun_ast::Loader,
    options: Options,
) -> Option<Box<bun_ast::Ast<'a>>> {
    let mut opts = bun_js_parser::ParserOptions::init(Default::default(), loader);
    // Print what is there: no dead-code removal, no macro execution, no import trimming.
    opts.features.dead_code_elimination = false;
    opts.features.no_macros = true;
    opts.features.trim_unused_imports = false;
    opts.features.minify_syntax = options.minify_syntax;
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

fn print_js<'a>(
    arena: &'a Arena,
    mut ast: Box<bun_ast::Ast<'a>>,
    source: &'a bun_ast::Source,
    options: Options,
) -> Option<Normalized> {
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

    let mut collector = ChunkCollector(None);
    let mut printer = bun_js_printer::BufferPrinter::init(bun_js_printer::BufferWriter::init());
    let sym_arena = *ast.symbols.allocator();
    let symbols = bun_ast::symbol::Map::init_with_one_list(
        core::mem::replace(&mut ast.symbols, bun_alloc::ArenaVec::new_in(sym_arena))
            .into_iter()
            .collect(),
    );
    let print_opts = bun_js_printer::Options {
        transform_only: true,
        minify_syntax: options.minify_syntax,
        require_ref: Some(ast.require_ref),
        import_meta_ref: ast.import_meta_ref,
        source_map_handler: Some(bun_js_printer::SourceMapHandler::for_(&mut collector)),
        mangled_props: None,
        ..Default::default()
    };
    bun_js_printer::print_ast::<_, false, true>(
        &mut printer,
        arena,
        &ast,
        symbols,
        source,
        print_opts,
    )
    .ok()?;
    let text = printer.ctx.get_written().to_vec();

    let mut line_map = Vec::new();
    if let Some(chunk) = collector.0 {
        let printed_lines = bun_core::strings::count_char(&text, b'\n') + 1;
        if let Ok(parsed) = bun_sourcemap::mapping::parse(
            chunk.buffer.list.as_slice(),
            None,
            1,
            printed_lines,
            bun_sourcemap::mapping::ParseOptions {
                allow_names: false,
                sort: true,
            },
        ) {
            line_map.reserve(printed_lines);
            let mut last = 1u32;
            for line in 0..printed_lines {
                // The last mapping on the printed line tells us where its content came from.
                if let Some(m) = parsed.mappings.find(
                    Ordinal::from_zero_based(line as i32),
                    Ordinal::from_zero_based(i32::MAX - 1),
                ) {
                    last = (m.original_line() + 1).max(1) as u32;
                }
                line_map.push(last);
            }
        }
    }
    Some(Normalized {
        text,
        line_map,
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
    arenas: [&'s Arena; 2],
    symbols: [&'s mut [bun_ast::Symbol]; 2],
    renamed: [Vec<bool>; 2],
    /// Short names some global already answers to (`$`, `_`, `ga`); never handed out.
    taken: Vec<Vec<u8>>,
    scratch: Vec<u8>,
}

#[derive(Clone, Copy)]
struct Candidate {
    symbol: usize,
    kind: u8,
    /// kind + bucketed use count: hub symbols keep their bucket when a release adds a call site or two.
    fingerprint: u64,
}

fn count_bucket(n: u32) -> u64 {
    if n < 6 {
        u64::from(n)
    } else {
        6 + u64::from((n / 3).ilog2())
    }
}

impl<'s> Namer<'s> {
    fn new(
        arena_o: &'s Arena,
        arena_n: &'s Arena,
        old: &'s mut [bun_ast::Symbol],
        new: &'s mut [bun_ast::Symbol],
    ) -> Namer<'s> {
        let mut taken = Vec::new();
        for sym in old.iter().chain(new.iter()) {
            if sym.kind == bun_ast::symbol::Kind::Unbound && sym.original_name.len() <= 3 {
                taken.push(sym.original_name.slice().to_vec());
            }
        }
        Namer {
            arenas: [arena_o, arena_n],
            renamed: [vec![false; old.len()], vec![false; new.len()]],
            symbols: [old, new],
            taken,
            scratch: Vec::new(),
        }
    }

    fn root(symbols: &[bun_ast::Symbol], mut i: usize) -> usize {
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
    fn candidates(&self, side: usize, scope: &bun_ast::Scope) -> Vec<Candidate> {
        let symbols = &*self.symbols[side];
        let mut members: Vec<(i32, u32)> = scope
            .members
            .values()
            .map(|m| (m.loc.start, m.ref_.inner_index()))
            .collect();
        members.extend(scope.generated.iter().map(|r| (i32::MAX, r.inner_index())));
        members.sort_unstable();
        let mut out = Vec::with_capacity(members.len());
        for (_, inner) in members {
            let i = Self::root(symbols, inner as usize);
            let sym = &symbols[i];
            if self.renamed[side][i]
                || sym.original_name.len() > 2
                || sym.slot_namespace() != bun_ast::symbol::SlotNamespace::Default
            {
                continue;
            }
            if out.iter().any(|c: &Candidate| c.symbol == i) {
                continue;
            }
            out.push(Candidate {
                symbol: i,
                kind: sym.kind as u8,
                fingerprint: (sym.kind as u64) << 32 | count_bucket(sym.use_count_estimate),
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
        if matches!(out.as_slice(), b"do" | b"if" | b"in" | b"of")
            || self.taken.iter().any(|t| t == out)
        {
            out.push(b'_');
        }
        self.symbols[side][symbol].original_name =
            bun_ast::StoreStr::new(self.arenas[side].alloc_slice_copy(out));
        self.renamed[side][symbol] = true;
    }

    fn plan(&mut self, old: Option<&bun_ast::Scope>, new: Option<&bun_ast::Scope>, depth: usize) {
        let co = old.map_or(Vec::new(), |s| self.candidates(0, s));
        let cn = new.map_or(Vec::new(), |s| self.candidates(1, s));
        let mut index = 0;
        let mut aligned = align(&co, &cn, |c| c.fingerprint);
        rematch_runs(&mut aligned, |i, j| co[i].kind == cn[j].kind);
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
        let ko: Vec<&bun_ast::Scope> =
            old.map_or(Vec::new(), |s| s.children.iter().map(|c| &**c).collect());
        let kn: Vec<&bun_ast::Scope> =
            new.map_or(Vec::new(), |s| s.children.iter().map(|c| &**c).collect());
        for (o, n) in pair_scopes(&ko, &kn) {
            self.plan(o, n, child_depth);
        }
    }
}

/// Which child scope on the old side is "the same" scope on the new side. Only scopes that declare a lot need a
/// good answer (small ones name positionally either way), so those are matched by kind and closest member count
/// first; the rest fall to an in-order alignment on kind.
fn pair_scopes<'a>(
    old: &[&'a bun_ast::Scope],
    new: &[&'a bun_ast::Scope],
) -> Vec<(Option<&'a bun_ast::Scope>, Option<&'a bun_ast::Scope>)> {
    const BIG: usize = 24;
    fn weight(s: &bun_ast::Scope) -> usize {
        s.members.len() + s.children.iter().map(|c| weight(c)).sum::<usize>()
    }
    let wo: Vec<usize> = old.iter().map(|s| weight(s)).collect();
    let wn: Vec<usize> = new.iter().map(|s| weight(s)).collect();
    let mut out = Vec::with_capacity(old.len().max(new.len()));
    let mut old_used = vec![false; old.len()];
    let mut new_used = vec![false; new.len()];
    // Heaviest first, so the one scope that matters most gets first pick.
    let mut order: Vec<usize> = (0..new.len()).filter(|&j| wn[j] >= BIG).collect();
    order.sort_by_key(|&j| core::cmp::Reverse(wn[j]));
    for j in order {
        let best = (0..old.len())
            .filter(|&i| !old_used[i] && old[i].kind == new[j].kind && wo[i] >= BIG / 2)
            .min_by_key(|&i| wo[i].abs_diff(wn[j]));
        if let Some(i) = best {
            if wo[i].abs_diff(wn[j]) * 2 <= wn[j] {
                old_used[i] = true;
                new_used[j] = true;
                out.push((Some(old[i]), Some(new[j])));
            }
        }
    }
    let ro: Vec<usize> = (0..old.len()).filter(|&i| !old_used[i]).collect();
    let rn: Vec<usize> = (0..new.len()).filter(|&j| !new_used[j]).collect();
    let mut rest = align_by(
        &ro,
        &rn,
        |&i| (old[i].kind as u64) << 32 | wo[i] as u64,
        |&j| (new[j].kind as u64) << 32 | wn[j] as u64,
    );
    rematch_runs(&mut rest, |a, b| old[ro[a]].kind == new[rn[b]].kind);
    for (a, b) in rest {
        out.push((a.map(|a| old[ro[a]]), b.map(|b| new[rn[b]])));
    }
    out
}

/// Between two matched anchors, leftovers whose fingerprint drifted (a use count crossed a bucket) are still
/// almost certainly the same symbols; pair them off in order when `compatible` agrees.
fn rematch_runs(
    aligned: &mut Vec<(Option<usize>, Option<usize>)>,
    compatible: impl Fn(usize, usize) -> bool,
) {
    let mut out = Vec::with_capacity(aligned.len());
    let mut k = 0;
    while k < aligned.len() {
        if aligned[k].0.is_some() && aligned[k].1.is_some() {
            out.push(aligned[k]);
            k += 1;
            continue;
        }
        let run_start = k;
        while k < aligned.len() && !(aligned[k].0.is_some() && aligned[k].1.is_some()) {
            k += 1;
        }
        let olds: Vec<usize> = aligned[run_start..k].iter().filter_map(|p| p.0).collect();
        let mut news: Vec<Option<usize>> = aligned[run_start..k]
            .iter()
            .filter_map(|p| p.1)
            .map(Some)
            .collect();
        for i in olds {
            match news
                .iter_mut()
                .find(|j| j.is_some_and(|j| compatible(i, j)))
            {
                Some(slot) => out.push((Some(i), slot.take())),
                None => out.push((Some(i), None)),
            }
        }
        out.extend(news.into_iter().flatten().map(|j| (None, Some(j))));
    }
    *aligned = out;
}

/// LCS alignment of two keyed sequences: yields every element of both, matched ones together, in merged order.
fn align<T>(
    a: &[T],
    b: &[T],
    key: impl Fn(&T) -> u64 + Copy,
) -> Vec<(Option<usize>, Option<usize>)> {
    align_by(a, b, key, key)
}

fn align_by<A, B>(
    a: &[A],
    b: &[B],
    ka: impl Fn(&A) -> u64,
    kb: impl Fn(&B) -> u64,
) -> Vec<(Option<usize>, Option<usize>)> {
    let (n, m) = (a.len(), b.len());
    let mut out = Vec::with_capacity(n.max(m));
    // Trim the common head and tail so the quadratic part only sees the churn.
    let head = a.iter().zip(b).take_while(|(x, y)| ka(x) == kb(y)).count();
    let tail = a[head..]
        .iter()
        .rev()
        .zip(b[head..].iter().rev())
        .take_while(|(x, y)| ka(x) == kb(y))
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
            if ka(&a2[i]) == kb(&b2[j]) {
                out.push((Some(head + i), Some(head + j)));
                i += 1;
                j += 1;
                continue;
            }
            let da = (1..WINDOW).find(|&d| i + d < n2 && ka(&a2[i + d]) == kb(&b2[j]));
            let db = (1..WINDOW).find(|&d| j + d < m2 && kb(&b2[j + d]) == ka(&a2[i]));
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
        let w = m2 + 1;
        let mut dp = vec![0u32; (n2 + 1) * w];
        for i in (0..n2).rev() {
            for j in (0..m2).rev() {
                dp[i * w + j] = if ka(&a2[i]) == kb(&b2[j]) {
                    dp[(i + 1) * w + j + 1] + 1
                } else {
                    dp[(i + 1) * w + j].max(dp[i * w + j + 1])
                };
            }
        }
        let (mut i, mut j) = (0, 0);
        while i < n2 || j < m2 {
            if i < n2 && j < m2 && ka(&a2[i]) == kb(&b2[j]) {
                out.push((Some(head + i), Some(head + j)));
                i += 1;
                j += 1;
            } else if j < m2 && (i == n2 || dp[i * w + j + 1] >= dp[(i + 1) * w + j]) {
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

fn normalize_css(path: &[u8], bytes: &[u8]) -> Option<Normalized> {
    let arena = Arena::new();
    // SAFETY: the stylesheet and everything it borrows from the arena are dropped before `arena` at the end of this fn.
    let alloc: &'static Arena = unsafe { bun_ptr::detach_lifetime_ref::<Arena>(&arena) };
    let mut opts = bun_css::ParserOptions::default(None);
    opts.filename = Vec::leak(path.to_vec());
    let mut import_records = Vec::<bun_ast::ImportRecord>::default();
    let (sheet, _extra) = bun_css::StyleSheet::<bun_css::DefaultAtRule>::parse(
        alloc,
        bytes,
        opts,
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
            None,
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
        line_map: Vec::new(),
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
        text: printer.ctx.get_written().to_vec(),
        line_map: Vec::new(),
        imports: Vec::new(),
        was_minified: false,
    })
}

/// Things a reviewer wants called out when they newly appear in a release. Counted on canonical text so formatting cannot hide them.
pub(crate) const SIGNALS: &[(&[u8], &str)] = &[
    (b"eval(", "eval()"),
    (b"new Function(", "new Function()"),
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
        let mut rest = text;
        while let Some(pos) = bun_core::strings::index_of(rest, needle) {
            out[i] += 1;
            rest = &rest[pos + needle.len()..];
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

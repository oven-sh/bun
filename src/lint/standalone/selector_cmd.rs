//! `bun-lint selector ..`: for the oracle of `bun_lint::selector`, test/cli/lint/oracle/selector.
//!
//! - `parse <selectors.json>`: for each of an array of selectors a line, `{"exit"}` or `{"error"}`, and then `{"order"}`: the
//!   indices of the valid ones as `Selector::compare` sorts them.
//! - `match <cases.jsonl>`: a line of the input is `{"id", "filename", "code", "sourceType", "parser", "selectors"}`, a line of the
//!   output `{"id", "matches": [[selector, type, start, end], ..]}` in the order of the reports of a rule that listens as
//!   `no-restricted-syntax` does, or `{"id", "error"}`. Positions are in UTF-16 code units.
//! - `bench <path> [--repeat=n] [--espree] <selector>..`: what each selector costs on the files in `path`, beyond what a rule that
//!   finds nothing to listen for costs.

use crate::host::{self, output_line};
use bun_core::strings::Utf16OffsetTable;
use bun_lint::context::Severity;
use bun_lint::language::{LanguageOptions, Parser, SourceType};
use bun_lint::prelude::*;
use bun_lint::runner::Enabled;
use bun_lint::selector::{self, EsNode, Selector};
use std::io::Write as _;
use std::sync::atomic::{AtomicU64, Ordering::Relaxed};

pub(crate) fn run(args: &[String]) {
    match args {
        [command, path] if command == "parse" => parse(path),
        [command, path] if command == "match" => match_cases(path),
        [command, path, rest @ ..] if command == "bench" => bench(path, rest),
        _ => output_line!(
            "usage: bun-lint selector parse <selectors.json> | match <cases.jsonl> | bench <path> <selector>.."
        ),
    }
}

fn quoted(text: &[u8]) -> String {
    host::text(&bun_core::printer::json_stringify_alloc(text))
}

fn parse(path: &str) {
    let json = bun_lint::json::parse(&host::read(path).expect("the selectors")).expect("JSON");
    let sources: Vec<&[u8]> = json
        .as_array()
        .unwrap_or_default()
        .iter()
        .filter_map(Json::as_str)
        .collect();
    let mut valid = Vec::new();
    for (i, source) in sources.iter().enumerate() {
        match Selector::parse(source) {
            Ok(selector) => {
                output_line!("{{\"exit\":{}}}", selector.is_exit());
                valid.push((i, selector));
            }
            Err(error) => output_line!("{{\"error\":{}}}", quoted(error.message())),
        }
    }
    valid.sort_by(|a, b| a.1.compare(&b.1));
    let order: Vec<String> = valid.iter().map(|it| it.0.to_string()).collect();
    output_line!("{{\"order\":[{}]}}", order.join(","));
}

// ───────────────────────────── a rule that reports what matches ─────────────────────────────

/// Reports each match of each of its options, which are selectors, with the index of the selector and the type of the node.
///
/// `COUNTS`: it counts what it is called with, which takes time.
struct Probe<const COUNTS: bool> {
    /// With the index among the options, in the order of `Selector::compare`.
    selectors: Vec<(usize, Selector)>,
}

const FOUND: Message = Message::new("found", "{{selector}} {{type}}");

/// The nodes of `bun_lint::ast` that the listeners of a `Probe` are called with, and the nodes of the ESTree made of them.
static LISTENED: AtomicU64 = AtomicU64::new(0);
static EXAMINED: AtomicU64 = AtomicU64::new(0);

impl<const COUNTS: bool> Rule for Probe<COUNTS> {
    const META: Meta = Meta::eslint("probe", Kind::Problem);
    const ON: On = On::new().nodes(NodeTags::ALL).finish();
    type State<'a> = Vec<(EsNode<'a>, usize)>;

    fn new(options: &Options) -> Self {
        let sources = options
            .all()
            .iter()
            .enumerate()
            .filter_map(|(i, it)| Some((i, it.as_str()?)));
        let mut selectors: Vec<_> = sources
            .filter_map(|(i, it)| Some((i, Selector::parse(it).ok()?)))
            .collect();
        selectors.sort_by(|a, b| a.1.compare(&b.1));
        Probe { selectors }
    }

    fn narrow<'a>(&self, _: &'a File<'a>) -> On {
        let selectors = self.selectors.iter();
        On::new()
            .nodes(selectors.fold(NodeTags::EMPTY, |tags, it| tags | it.1.listens_to()))
            .finish()
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Self::State<'a>> {
        Some(Vec::new())
    }

    fn node<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        if COUNTS {
            LISTENED.fetch_add(1, Relaxed);
        }
        EsNode::for_each_at(node, |it| {
            if COUNTS {
                EXAMINED.fetch_add(1, Relaxed);
            }
            let matching = self
                .selectors
                .iter()
                .enumerate()
                .filter(|(_, selector)| selector.1.matches(it));
            cx.state.extend(matching.map(|(i, _)| (it, i)));
        });
    }

    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        let mut found = std::mem::take(&mut cx.state);
        selector::sort_as_called(&mut found, |i| self.selectors[i].1.is_exit());
        for (node, i) in found {
            cx.report(node, FOUND)
                .data("selector", self.selectors[i].0)
                .data("type", node.type_name());
        }
    }
}

// ───────────────────────────── match ─────────────────────────────

fn language_of(parser: Option<&[u8]>, source_type: Option<&[u8]>) -> LanguageOptions {
    LanguageOptions {
        parser: match parser {
            Some(b"typescript") => Parser::TypeScript,
            _ => Parser::Espree,
        },
        source_type: match source_type {
            Some(b"script") => SourceType::Script,
            Some(b"commonjs") => SourceType::CommonJs,
            _ => SourceType::Module,
        },
        jsx: true,
        ..LanguageOptions::default()
    }
}

fn match_cases(path: &str) {
    std::panic::set_hook(Box::new(|_| {}));
    let input = host::read(path).expect("the cases");
    let mut stdout = std::io::BufWriter::new(std::io::stdout().lock());
    for line in bun_core::strings::split(&input, b"\n").filter(|line| !line.is_empty()) {
        let Some(case) = bun_lint::json::parse(line) else {
            continue;
        };
        let field = |name: &[u8]| case.get(name).and_then(Json::as_str);
        let (Some(id), Some(filename), Some(code)) =
            (field(b"id"), field(b"filename"), field(b"code"))
        else {
            continue;
        };
        let selectors = case
            .get(b"selectors")
            .and_then(Json::as_array)
            .unwrap_or_default();
        let language = language_of(field(b"parser"), field(b"sourceType"));
        let invalid = selectors
            .iter()
            .filter_map(Json::as_str)
            .find_map(|it| Selector::parse(it).err());
        let outcome = std::panic::catch_unwind(|| {
            if let Some(error) = invalid {
                return Err(error.to_string());
            }
            let rule = Probe::<false>::new(&Options::new(selectors));
            crate::with_file(&host::text(filename), code, &language, |file| {
                if file.has_parse_errors() {
                    return Err("parse".to_owned());
                }
                let enabled = Enabled {
                    rule: &rule,
                    severity: Severity::Error,
                };
                let offsets = Utf16OffsetTable::without_bom(code);
                let found = bun_lint::runner::run(file, &[enabled], false);
                let found = found.iter().map(|it| {
                    let message = host::text(&it.message);
                    let (selector, node_type) = host::split_once(&message, " ").unwrap_or_default();
                    format!(
                        "[{selector},\"{node_type}\",{},{}]",
                        offsets.to_utf16(it.span.start),
                        offsets.to_utf16(it.span.end)
                    )
                });
                Ok(found.collect::<Vec<_>>().join(","))
            })
        });
        let _ = match outcome.unwrap_or_else(|_| Err("panic".to_owned())) {
            Ok(matches) => writeln!(stdout, "{{\"id\":{},\"matches\":[{matches}]}}", quoted(id)),
            Err(error) => writeln!(
                stdout,
                "{{\"id\":{},\"error\":{}}}",
                quoted(id),
                quoted(error.as_bytes())
            ),
        };
    }
}

// ───────────────────────────── bench ─────────────────────────────

/// The time that this thread has been running, in nanoseconds: what others do on the machine does not count. Where the system does
/// not tell, the time that has passed.
fn cpu_nanos(started: std::time::Instant) -> u64 {
    let stat = host::read_text("/proc/thread-self/schedstat").ok();
    let running = stat.and_then(|it| it.split_whitespace().next()?.parse().ok());
    running.unwrap_or_else(|| started.elapsed().as_nanos() as u64)
}

fn bench(path: &str, rest: &[String]) {
    let flag = |name: &str| rest.iter().find_map(|it| it.strip_prefix(name));
    let repeat: u32 = flag("--repeat=")
        .and_then(|it| it.parse().ok())
        .unwrap_or(5);
    let parser: &[u8] = if rest.iter().any(|it| it == "--espree") {
        b"espree"
    } else {
        b"typescript"
    };
    let language = language_of(Some(parser), None);
    let mut paths = Vec::new();
    crate::collect(std::path::Path::new(path), &mut paths);
    let files: Vec<(String, Vec<u8>)> = (paths.iter())
        .filter_map(|path| Some((path.to_string_lossy().into_owned(), host::read(path).ok()?)))
        .collect();
    // The first has next to nothing to listen for: what it takes is what running a rule and measuring take.
    let baseline = "DebuggerStatement".to_owned();
    let selectors: Vec<&String> = std::iter::once(&baseline)
        .chain(rest.iter().filter(|it| !it.starts_with("--")))
        .collect();
    let rules: Vec<_> = (selectors.iter())
        .map(|it| {
            let options = [Json::String(it.as_bytes().to_vec())];
            (
                Probe::<false>::new(&Options::new(&options)),
                Probe::<true>::new(&Options::new(&options)),
            )
        })
        .collect();
    let started = std::time::Instant::now();
    let mut nanos = vec![0u64; rules.len()];
    let mut counts = vec![(0u64, 0u64, 0u64); rules.len()];
    for (path, code) in &files {
        crate::with_file(path, code, &language, |file| {
            if file.has_parse_errors() {
                return;
            }
            for (i, (rule, counting)) in rules.iter().enumerate() {
                let severity = Severity::Error;
                let counting = Enabled {
                    rule: counting,
                    severity,
                };
                // The first run computes what the file keeps.
                let (listened, examined) = (LISTENED.load(Relaxed), EXAMINED.load(Relaxed));
                counts[i].2 += bun_lint::runner::run(file, &[counting], false).len() as u64;
                let enabled = Enabled { rule, severity };
                counts[i].0 += LISTENED.load(Relaxed) - listened;
                counts[i].1 += EXAMINED.load(Relaxed) - examined;
                let before = cpu_nanos(started);
                for _ in 0..repeat {
                    std::hint::black_box(bun_lint::runner::run(file, &[enabled], false));
                }
                nanos[i] += (cpu_nanos(started) - before) / u64::from(repeat);
            }
        });
    }
    let bytes: usize = files.iter().map(|it| it.1.len()).sum();
    output_line!("{} files, {:.1} MB", files.len(), bytes as f64 / 1e6);
    for (i, selector) in selectors.iter().enumerate() {
        let (listened, examined, found) = counts[i];
        let net = nanos[i].saturating_sub(nanos[0]);
        output_line!(
            "{selector}: {:.2} ms, {listened} nodes listened for, {examined} ESTree nodes, {found} matches, {:.0} ns a node listened for",
            net as f64 / 1e6,
            net as f64 / listened.max(1) as f64,
        );
    }
}

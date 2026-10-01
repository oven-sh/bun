//! Compares what the resolver says with a dump made by the TypeScript compiler.

use bun_sema::check::Program;
use bun_sema::describe::Describer;
use bun_sema::program::FileId;
use bun_sema::sites::{SiteKind, for_each_site};
use std::collections::HashMap;
use std::sync::Mutex;

pub struct OracleFile {
    pub path: String,
    /// (offset, kind, index into `Oracle::descriptions`, feature flags)
    pub sites: Vec<(u32, SiteKind, u32, u8)>,
    /// (from, to, code) of the errors the compiler reports.
    pub errors: Vec<(u32, u32, u32)>,
}

/// A project of its own: a directory with a tsconfig.json.
pub struct OracleTest {
    pub dir: String,
    /// Why it is not to be scored.
    pub refused: Option<String>,
    /// Which of `Oracle::files` are its own.
    pub files: std::ops::Range<usize>,
}

pub struct Oracle {
    pub descriptions: Vec<String>,
    pub files: Vec<OracleFile>,
    pub tests: Vec<OracleTest>,
}

impl Oracle {
    pub fn parse(text: &str) -> Oracle {
        let mut oracle = Oracle {
            descriptions: Vec::new(),
            files: Vec::new(),
            tests: Vec::new(),
        };
        for line in text.lines() {
            let mut fields = line.split('\t');
            match fields.next() {
                Some("F") => {
                    oracle.files.push(OracleFile {
                        path: fields.next().unwrap().to_owned(),
                        sites: Vec::new(),
                        errors: Vec::new(),
                    });
                    if let Some(test) = oracle.tests.last_mut() {
                        test.files.end = oracle.files.len();
                    }
                }
                Some("T") => {
                    let at = oracle.files.len();
                    oracle.tests.push(OracleTest {
                        dir: fields.next().unwrap().to_owned(),
                        refused: None,
                        files: at..at,
                    });
                }
                Some("X") => {
                    oracle.tests.last_mut().unwrap().refused =
                        Some(fields.next().unwrap_or("").to_owned())
                }
                Some("E") => {
                    let mut number = || fields.next().unwrap().parse().unwrap();
                    let error = (number(), number(), number());
                    oracle.files.last_mut().unwrap().errors.push(error);
                }
                Some("D") => {
                    let id: usize = fields.next().unwrap().parse().unwrap();
                    assert_eq!(id, oracle.descriptions.len());
                    oracle
                        .descriptions
                        .push(line.splitn(3, '\t').nth(2).unwrap().to_owned());
                }
                Some("S") => {
                    let offset = fields.next().unwrap().parse().unwrap();
                    let kind = SiteKind::from_code(fields.next().unwrap()).unwrap();
                    let id = fields.next().unwrap().parse().unwrap();
                    let flags = fields.next().and_then(|f| f.parse().ok()).unwrap_or(0);
                    oracle
                        .files
                        .last_mut()
                        .unwrap()
                        .sites
                        .push((offset, kind, id, flags));
                }
                _ => {}
            }
        }
        oracle
    }
}

#[derive(Default, Clone, Copy)]
pub struct Tally {
    pub agree: u64,
    /// The resolver said nothing at all.
    pub unknown: u64,
    /// It said something with a hole in it.
    pub partial: u64,
    /// It has no such site.
    pub missing: u64,
    pub disagree: u64,
}

impl Tally {
    pub fn total(&self) -> u64 {
        self.agree + self.unknown + self.partial + self.missing + self.disagree
    }
    fn add(&mut self, other: &Tally) {
        self.agree += other.agree;
        self.unknown += other.unknown;
        self.partial += other.partial;
        self.missing += other.missing;
        self.disagree += other.disagree;
    }
}

#[derive(Default)]
pub struct Comparison {
    pub by_kind: HashMap<SiteKind, Tally>,
    /// By what it takes to get the site right. A site can be in several.
    pub by_feature: HashMap<&'static str, Tally>,
    /// (kind, expected, got) -> (how often, one place)
    pub disagreements: HashMap<(SiteKind, String, String), (u64, String)>,
    /// (kind, expected) -> (how often, one place), for sites that were not resolved.
    pub unknowns: HashMap<(SiteKind, String), (u64, String)>,
    pub files_not_loaded: u64,
    /// Of `suite`: tests scored, tests where every site agrees, tests the oracle refused, tests the parser rejected.
    pub tests: u64,
    pub tests_agreeing: u64,
    pub tests_refused: u64,
    pub tests_rejected: u64,
    pub rejected: Vec<String>,
    pub errors_expected: u64,
    pub tests_with_same_errors: u64,
    /// code -> (found, missed, made up)
    pub by_code: HashMap<u32, (u64, u64, u64)>,
    /// `path:offset code missed|FALSE`
    pub errors_bad: Vec<String>,
    /// Every site that does not agree: `path:offset kind status`. For telling what a change made worse.
    pub bad: Vec<String>,
}

/// No file takes anywhere near this. One that does has run into a bug: it is reported (`TIMEOUT`) and does not match.
fn file_time_limit() -> std::time::Duration {
    let ms = std::env::var("BUN_SEMA_FILE_LIMIT_MS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(3000);
    std::time::Duration::from_millis(ms)
}

pub fn describe_file(program: &Program, file: FileId) -> HashMap<(u32, SiteKind), String> {
    let mut checker = program.checker();
    checker.set_stack_limit(crate::STACK - (64 << 20));
    checker.set_time_limit(file_time_limit());
    let mut types = Vec::new();
    for_each_site(&mut checker, file, |_, pos, kind, ty| {
        types.push((pos, kind, ty))
    });
    if checker.timed_out() {
        eprintln!("TIMEOUT types {}", program.files.module(file).path);
    }
    let mut describer = Describer::new(&mut checker);
    let mut memo: HashMap<bun_sema::types::TypeId, String> = HashMap::new();
    let mut out = HashMap::with_capacity(types.len());
    for (pos, kind, ty) in types {
        let text = memo
            .entry(ty)
            .or_insert_with(|| describer.describe(ty))
            .clone();
        out.insert((pos, kind), text);
    }
    out
}

pub fn compare(
    program: &Program,
    tree: &str,
    oracle: &Oracle,
    threads: usize,
    only: Option<&str>,
) -> Comparison {
    let result = Mutex::new(Comparison::default());
    // BUN_SEMA_ORDER=reverse, or a number to shuffle by: the answers must not depend on which file is asked about first.
    let mut order: Vec<usize> = (0..oracle.files.len()).collect();
    match std::env::var("BUN_SEMA_ORDER").ok().as_deref() {
        Some("reverse") => order.reverse(),
        Some(seed) => {
            let mut state: u64 = seed.parse().unwrap_or(1) | 1;
            for i in (1..order.len()).rev() {
                state ^= state << 13;
                state ^= state >> 7;
                state ^= state << 17;
                order.swap(i, (state % (i as u64 + 1)) as usize);
            }
        }
        None => {}
    }
    let trace_files = std::env::var_os("BUN_SEMA_TRACE_FILES").is_some();
    let skip: Vec<String> = match std::env::var("BUN_SEMA_SKIP") {
        Ok(path) => std::fs::read_to_string(path)
            .unwrap_or_default()
            .lines()
            .map(str::to_owned)
            .collect(),
        Err(_) => Vec::new(),
    };
    crate::for_each_parallel(threads, oracle.files.len(), |i| {
        let expected = &oracle.files[order[i]];
        // For finding what crashes or hangs: says which file is next, and leaves out those named one per line in a file.
        if skip.iter().any(|s| s == &expected.path) {
            return;
        }
        if trace_files {
            eprintln!("FILE {}", expected.path);
        }
        if only.is_some_and(|o| !expected.path.contains(o)) {
            return;
        }
        let path = format!("{tree}/{}", expected.path);
        let Some(&file) = program.files.by_path.get(&path) else {
            result.lock().unwrap().files_not_loaded += 1;
            return;
        };
        let trace = std::env::var_os("BUN_SEMA_TRACE_FILES").is_some();
        if trace {
            eprintln!("START {}", expected.path);
        }
        let started = std::time::Instant::now();
        let mut local = compare_file(program, file, expected, &oracle.descriptions);
        compare_errors(program, file, expected, &mut local);
        if trace {
            eprintln!("DONE {} {}ms", expected.path, started.elapsed().as_millis());
        }
        result.lock().unwrap().merge(local);
    });
    result.into_inner().unwrap()
}

/// Every test of `oracle` as a program of its own, with the options its tsconfig.json asks for.
pub fn suite(root: &str, oracle: &Oracle, threads: usize, only: Option<&str>) -> Comparison {
    let result = Mutex::new(Comparison::default());
    let trace = std::env::var_os("BUN_SEMA_TRACE_FILES").is_some();
    let skip: Vec<String> = match std::env::var("BUN_SEMA_SKIP") {
        Ok(path) => std::fs::read_to_string(path)
            .unwrap_or_default()
            .lines()
            .map(str::to_owned)
            .collect(),
        Err(_) => Vec::new(),
    };
    crate::for_each_parallel(threads, oracle.tests.len(), |i| {
        let test = &oracle.tests[i];
        if only.is_some_and(|o| !test.dir.contains(o)) || skip.contains(&test.dir) {
            return;
        }
        if test.refused.is_some() {
            result.lock().unwrap().tests_refused += 1;
            return;
        }
        if trace {
            eprintln!("FILE {}", test.dir);
        }
        let files = crate::load_project(&format!("{root}/{}/tsconfig.json", test.dir));
        // What the parser refuses never gets as far as this.
        if files.modules.iter().any(|m| m.hir.has_errors) {
            let mut all = result.lock().unwrap();
            all.tests_rejected += 1;
            all.rejected.push(test.dir.clone());
            return;
        }
        let program = Program::new(files);
        let mut local = Comparison::default();
        // What is wrong with the configuration is written down as errors at the start of the test's tsconfig.json.
        let config = format!("{}/tsconfig.json", test.dir);
        let wanted = oracle.files[test.files.clone()]
            .iter()
            .find(|f| f.path == config)
            .map_or(&[][..], |f| &f.errors[..]);
        let mine: Vec<(u32, u32)> = program
            .files
            .configuration_errors()
            .into_iter()
            .map(|code| (0, code))
            .collect();
        compare_error_lists(&config, wanted, &mine, &mut local);
        for expected in &oracle.files[test.files.clone()] {
            local.errors_expected += expected.errors.len() as u64;
            if expected.path == config {
                continue;
            }
            match program
                .files
                .by_path
                .get(&format!("{root}/{}", expected.path))
            {
                Some(&file) => {
                    local.merge(compare_file(&program, file, expected, &oracle.descriptions));
                    compare_errors(&program, file, expected, &mut local);
                }
                None => local.files_not_loaded += 1,
            }
        }
        local.tests_with_same_errors += u64::from(local.errors_bad.is_empty());
        if trace {
            eprintln!("DONE {}", test.dir);
        }
        local.tests += 1;
        local.tests_agreeing += u64::from(local.bad.is_empty() && local.files_not_loaded == 0);
        result.lock().unwrap().merge(local);
    });
    result.into_inner().unwrap()
}

/// Errors are the same when they have the same code and start at the same place.
fn compare_errors(program: &Program, file: FileId, expected: &OracleFile, local: &mut Comparison) {
    let mut checker = program.checker();
    checker.set_stack_limit(crate::STACK - (64 << 20));
    checker.set_time_limit(file_time_limit());
    let mine: Vec<(u32, u32)> = checker
        .check_file(file)
        .into_iter()
        .map(|d| (d.start, d.code))
        .collect();
    if checker.timed_out() {
        eprintln!("TIMEOUT errors {}", expected.path);
    }
    compare_error_lists(&expected.path, &expected.errors, &mine, local);
}

fn compare_error_lists(
    path: &str,
    expected: &[(u32, u32, u32)],
    mine: &[(u32, u32)],
    local: &mut Comparison,
) {
    let mut wanted: Vec<(u32, u32)> = expected
        .iter()
        .map(|&(from, _, code)| (from, code))
        .collect();
    wanted.sort_unstable();
    wanted.dedup();
    for &(start, code) in &wanted {
        let tally = local.by_code.entry(code).or_default();
        if mine.contains(&(start, code)) {
            tally.0 += 1;
        } else {
            tally.1 += 1;
            local
                .errors_bad
                .push(format!("{path}:{start} {code} missed"));
        }
    }
    for &(start, code) in mine {
        if !wanted.contains(&(start, code)) {
            local.by_code.entry(code).or_default().2 += 1;
            local
                .errors_bad
                .push(format!("{path}:{start} {code} FALSE"));
        }
    }
}

/// The errors by code: how many were found, missed, made up.
pub fn error_table(comparison: &Comparison, limit: usize) -> String {
    let mut rows: Vec<(u32, (u64, u64, u64))> = comparison
        .by_code
        .iter()
        .map(|(&code, &t)| (code, t))
        .collect();
    rows.sort_unstable_by_key(|&(code, (found, missed, made_up))| {
        (std::cmp::Reverse(found + missed + made_up), code)
    });
    let total = rows
        .iter()
        .fold((0, 0, 0), |a, r| (a.0 + r.1.0, a.1 + r.1.1, a.2 + r.1.2));
    let mut out = String::from("code        found    missed     false\n");
    for (code, (found, missed, made_up)) in rows.iter().filter(|r| r.1.0 + r.1.2 > 0).take(limit) {
        out.push_str(&format!("{code:<8}{found:>9}{missed:>10}{made_up:>10}\n"));
    }
    out.push_str(&format!(
        "errors  {:>9}{:>10}{:>10}   found {:.1}% of what is expected; {:.1}% of what is reported is right\n",
        total.0,
        total.1,
        total.2,
        total.0 as f64 * 100.0 / (total.0 + total.1).max(1) as f64,
        total.0 as f64 * 100.0 / (total.0 + total.2).max(1) as f64
    ));
    out
}

fn compare_file(
    program: &Program,
    file: FileId,
    expected: &OracleFile,
    descriptions: &[String],
) -> Comparison {
    let mine = describe_file(program, file);
    let mut local = Comparison::default();
    {
        for &(offset, kind, id, flags) in &expected.sites {
            let want = &descriptions[id as usize];
            let before = local.by_kind.get(&kind).copied().unwrap_or_default();
            let tally = local.by_kind.entry(kind).or_default();
            let place = || format!("{}:{offset}", expected.path);
            match mine.get(&(offset, kind)) {
                None => {
                    tally.missing += 1;
                    let entry = local
                        .unknowns
                        .entry((kind, format!("(missing) {want}")))
                        .or_insert_with(|| (0, place()));
                    entry.0 += 1;
                }
                Some(got) if got == want || (want == "any" && got == "?") => tally.agree += 1,
                Some(got) if got.contains('?') && is_unresolved(got) => {
                    if got == "?" {
                        tally.unknown += 1;
                    } else {
                        tally.partial += 1;
                    }
                    let entry = local
                        .unknowns
                        .entry((kind, want.clone()))
                        .or_insert_with(|| (0, place()));
                    entry.0 += 1;
                }
                Some(got) => {
                    tally.disagree += 1;
                    let entry = local
                        .disagreements
                        .entry((kind, want.clone(), got.clone()))
                        .or_insert_with(|| (0, place()));
                    entry.0 += 1;
                }
            }
            let after = *tally;
            if after.agree == before.agree {
                let status = if after.disagree != before.disagree {
                    'D'
                } else if after.missing != before.missing {
                    'M'
                } else {
                    'U'
                };
                let width = std::env::var("BUN_SEMA_BAD_WIDTH")
                    .ok()
                    .and_then(|w| w.parse().ok())
                    .unwrap_or(160);
                let cut = |s: &str| s.chars().take(width).collect::<String>();
                let got = mine.get(&(offset, kind)).map_or("", |g| g.as_str());
                local.bad.push(format!(
                    "{}:{offset} {} {status}\t{}\t{}",
                    expected.path,
                    kind.code(),
                    cut(want),
                    cut(got)
                ));
            }
            for feature in features(kind, flags) {
                let t = local.by_feature.entry(feature).or_default();
                t.agree += after.agree - before.agree;
                t.unknown += after.unknown - before.unknown;
                t.partial += after.partial - before.partial;
                t.missing += after.missing - before.missing;
                t.disagree += after.disagree - before.disagree;
            }
        }
    }
    local
}

impl Comparison {
    fn merge(&mut self, mut local: Comparison) {
        self.bad.append(&mut local.bad);
        self.rejected.append(&mut local.rejected);
        self.files_not_loaded += local.files_not_loaded;
        self.tests += local.tests;
        self.tests_agreeing += local.tests_agreeing;
        self.tests_refused += local.tests_refused;
        self.tests_rejected += local.tests_rejected;
        self.errors_expected += local.errors_expected;
        self.tests_with_same_errors += local.tests_with_same_errors;
        self.errors_bad.append(&mut local.errors_bad);
        for (code, t) in &local.by_code {
            let all = self.by_code.entry(*code).or_default();
            *all = (all.0 + t.0, all.1 + t.1, all.2 + t.2);
        }
        for (kind, tally) in &local.by_kind {
            self.by_kind.entry(*kind).or_default().add(tally);
        }
        for (feature, tally) in &local.by_feature {
            self.by_feature.entry(feature).or_default().add(tally);
        }
        for (key, (count, place)) in local.disagreements {
            let entry = self.disagreements.entry(key).or_insert((0, place));
            entry.0 += count;
        }
        for (key, (count, place)) in local.unknowns {
            let entry = self.unknowns.entry(key).or_insert((0, place));
            entry.0 += count;
        }
    }
}

const FEATURES: [&str; 9] = [
    "param, annotated",
    "param, from context",
    "variable, annotated",
    "variable, inferred",
    "return, annotated",
    "return, inferred",
    "narrowed",
    "generic call, inferred",
    "conditional/mapped/T[K]",
];

fn features(kind: SiteKind, flags: u8) -> Vec<&'static str> {
    let mut out = Vec::new();
    let inferred = flags & 1 != 0;
    match kind {
        SiteKind::Param => out.push(FEATURES[usize::from(inferred)]),
        SiteKind::Var => out.push(FEATURES[2 + usize::from(inferred)]),
        SiteKind::FnReturn => out.push(FEATURES[4 + usize::from(inferred)]),
        _ => {}
    }
    if flags & 2 != 0 {
        out.push(FEATURES[6]);
    }
    if flags & 4 != 0 {
        out.push(FEATURES[7]);
    }
    if flags & 8 != 0 {
        out.push(FEATURES[8]);
    }
    out
}

/// Whether a `?` in `text` stands for "unresolved", as opposed to marking something optional.
fn is_unresolved(text: &str) -> bool {
    let bytes = text.as_bytes();
    let mut in_string = false;
    for (i, &b) in bytes.iter().enumerate() {
        if in_string {
            if b == b'"' && bytes[i - 1] != b'\\' {
                in_string = false;
            }
            continue;
        }
        match b {
            b'"' => in_string = true,
            b'?' => {
                let before = if i == 0 { b'(' } else { bytes[i - 1] };
                let after = bytes.get(i + 1).copied().unwrap_or(b')');
                if matches!(
                    before,
                    b'(' | b'<' | b',' | b':' | b'|' | b'[' | b'>' | b'.'
                ) && matches!(after, b')' | b'>' | b',' | b'|' | b']' | b'}' | b'?')
                {
                    return true;
                }
            }
            _ => {}
        }
    }
    false
}

pub fn table(comparison: &Comparison) -> String {
    let mut out = String::from(
        "kind                          total     agree   unknown   partial   missing  disagree   agree%  disagree%\n",
    );
    let mut total = Tally::default();
    let mut row = |name: &str, t: &Tally| {
        let n = t.total().max(1) as f64;
        out.push_str(&format!(
            "{name:<25}{:>10}{:>10}{:>10}{:>10}{:>10}{:>10}{:>9.1}{:>11.1}\n",
            t.total(),
            t.agree,
            t.unknown,
            t.partial,
            t.missing,
            t.disagree,
            t.agree as f64 * 100.0 / n,
            t.disagree as f64 * 100.0 / n
        ));
    };
    for kind in SiteKind::ALL {
        if let Some(t) = comparison.by_kind.get(&kind) {
            row(kind.code(), t);
            total.add(t);
        }
    }
    row("all", &total);
    for feature in FEATURES {
        if let Some(t) = comparison.by_feature.get(feature) {
            row(feature, t);
        }
    }
    out
}

/// The most frequent ways of being wrong and of not knowing. Has identifiers of the program in it.
pub fn report(comparison: &Comparison, limit: usize) -> String {
    let mut out = String::new();
    let mut disagreements: Vec<_> = comparison.disagreements.iter().collect();
    disagreements.sort_by(|a, b| b.1.0.cmp(&a.1.0).then(a.0.cmp(b.0)));
    out.push_str("== DISAGREE (count, kind, expected, got, one place)\n");
    let cut = |s: &str| {
        if s.len() > 160 && limit < 10_000 {
            format!(
                "{}…",
                &s[..s
                    .char_indices()
                    .take_while(|c| c.0 < 160)
                    .last()
                    .map_or(0, |c| c.0)]
            )
        } else {
            s.to_owned()
        }
    };
    for ((kind, want, got), (count, place)) in disagreements.into_iter().take(limit) {
        out.push_str(&format!(
            "{count}\t{}\t{}\t{}\t{place}\n",
            kind.code(),
            cut(want),
            cut(got)
        ));
    }
    let mut unknowns: Vec<_> = comparison.unknowns.iter().collect();
    unknowns.sort_by(|a, b| b.1.0.cmp(&a.1.0).then(a.0.cmp(b.0)));
    out.push_str("== UNKNOWN (count, kind, expected, one place)\n");
    for ((kind, want), (count, place)) in unknowns.into_iter().take(limit) {
        out.push_str(&format!(
            "{count}\t{}\t{}\t{place}\n",
            kind.code(),
            cut(want)
        ));
    }
    out
}

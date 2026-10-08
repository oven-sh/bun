//! `bun-lint parser`: what the parser says about inputs, in each dialect.
//!
//! - `errors <inputs.jsonl> [--typescript|--babel|--tsc]`: the first error of each input that is refused. A line of the input is
//!   `{"id", "filename", "code", "sourceType"}`. It is parsed as espree does, or as the flag says.
//! - `file <path> [--script] [--typescript|--babel|--tsc]`: all the diagnostics of a file.

use bun_lint::options::Json;
use bun_sema::atom::Interner;
use bun_sema::hir::Diagnostic;
use bun_sema::resolve::Dialect;
use bun_sema::session::Session;

pub(crate) fn run(args: &[String]) {
    let has = |flag: &str| args.iter().any(|it| it == flag);
    let dialect = |script: bool| match () {
        () if has("--typescript") => Dialect::typescript_estree(script),
        () if has("--babel") => Dialect::babel(script),
        () if has("--tsc") => Dialect::default(),
        () => Dialect::espree(script),
    };
    match args {
        [command, path, ..] if command == "errors" => errors(path, &dialect),
        [command, path, ..] if command == "file" => {
            let code = std::fs::read(path).expect("the file");
            let (is_refused, diagnostics) = parse(path, &code, dialect(has("--script")));
            println!("{}", if is_refused { "refused" } else { "accepted" });
            diagnostics.iter().for_each(|it| println!("{}", describe(&code, it)));
        }
        _ => println!("usage: bun-lint parser errors <inputs.jsonl> | file <path>"),
    }
}

/// Whether the parser refuses `code`, and what it reports.
fn parse(path: &str, code: &[u8], dialect: Dialect) -> (bool, Vec<Diagnostic>) {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let path = path.as_bytes();
    let hir = bun_js_parser::sema::summarize_as(dialect, session.arena(), path, None, code, &atoms, false, !dialect.script).0;
    (hir.has_errors || hir.has_parse_diagnostics, hir.diagnostics.to_vec())
}

/// `Parse 1005 ';' expected. at 12: let a ‸b`
fn describe(code: &[u8], diagnostic: &Diagnostic) -> String {
    let mut message = Vec::new();
    if let Some((_, text)) = bun_sema::messages::message(diagnostic.code) {
        bun_sema::messages::format(&mut message, text, &diagnostic.args);
    }
    let at = (diagnostic.start as usize).min(code.len());
    let is_break = |it: &u8| matches!(it, b'\n' | b'\r');
    let start = code[..at].iter().rposition(is_break).map_or(0, |it| it + 1).max(at.saturating_sub(60));
    let end = code[at..].iter().position(is_break).map_or(code.len(), |it| at + it).min(at + 40);
    format!(
        "{:?} {} {} at {at}: {}\u{2038}{}",
        diagnostic.kind,
        diagnostic.code,
        String::from_utf8_lossy(&message),
        String::from_utf8_lossy(&code[start..at]),
        String::from_utf8_lossy(&code[at..end]),
    )
}

fn errors(path: &str, dialect: &dyn Fn(bool) -> Dialect) {
    let text = std::fs::read(path).expect("the inputs");
    let mut refused = 0;
    for line in bun_core::strings::split(&text, b"\n").filter(|line| !line.is_empty()) {
        let Some(json) = bun_lint::json::parse(line) else {
            continue;
        };
        let field = |name: &[u8]| json.get(name).and_then(Json::as_str).unwrap_or_default();
        let script = matches!(field(b"sourceType"), b"script" | b"commonjs");
        let (filename, code) = (String::from_utf8_lossy(field(b"filename")), field(b"code"));
        let (is_refused, diagnostics) = parse(&filename, code, dialect(script));
        if is_refused {
            refused += 1;
            let first = diagnostics.iter().min_by_key(|it| it.start);
            let first = first.map_or("?".to_owned(), |it| describe(code, it));
            println!("{}\t{first}", String::from_utf8_lossy(field(b"id")));
        }
    }
    println!("{refused} refused");
}

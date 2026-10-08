//! `bun-lint semantic ..`
//!
//! - `dump <file>`: the scopes, variables and references of a file, as JSON.
//! - `dump --batch <cases.jsonl>`: the same for each case of `test/cli/lint/oracle/semantic/cases.ts`, a line for each, to
//!   compare with what `dump.ts` there prints.
//! - `bench <paths..> [--repeat=n]`: how long it takes to derive each part.

use bun_lint::ast::{File, Node, StmtKind, TypeKind};
use bun_lint::language::{LanguageOptions, SourceType};
use bun_lint::options::Json;
use bun_lint::semantic::{DeclarationKind, Reference, Scope, ScopeKind, Symbol};

fn string(text: impl AsRef<[u8]>) -> Json {
    Json::String(text.as_ref().to_vec())
}

fn number(n: u32) -> Json {
    Json::Number(f64::from(n))
}

/// Offsets in bytes to offsets in UTF-16 code units.
struct Offsets(Option<Vec<u32>>);

impl Offsets {
    fn new(text: &[u8]) -> Offsets {
        if text.is_ascii() {
            return Offsets(None);
        }
        let (mut table, mut units) = (Vec::with_capacity(text.len() + 1), 0);
        for &byte in text {
            table.push(units);
            // The first byte of a character counts for all of it.
            units += match byte {
                0x80..=0xBF => 0,
                0xF0..=0xFF => 2,
                _ => 1,
            };
        }
        table.push(units);
        Offsets(Some(table))
    }

    fn of(&self, offset: u32) -> u32 {
        match &self.0 {
            Some(table) => table.get(offset as usize).or(table.last()).copied().unwrap_or(0),
            None => offset,
        }
    }
}

fn kind_name(kind: ScopeKind) -> &'static str {
    match kind {
        ScopeKind::Global => "global",
        ScopeKind::Module => "module",
        ScopeKind::Function => "function",
        ScopeKind::FunctionExpressionName => "function-expression-name",
        ScopeKind::Block => "block",
        ScopeKind::Switch => "switch",
        ScopeKind::Catch => "catch",
        ScopeKind::With => "with",
        ScopeKind::For => "for",
        ScopeKind::Class => "class",
        ScopeKind::ClassFieldInitializer => "class-field-initializer",
        ScopeKind::ClassStaticBlock => "class-static-block",
        ScopeKind::TsModule => "tsModule",
        ScopeKind::TsEnum => "tsEnum",
        ScopeKind::Type => "type",
        ScopeKind::ConditionalType => "conditionalType",
        ScopeKind::FunctionType => "functionType",
        ScopeKind::MappedType => "mappedType",
    }
}

fn declaration_kind_name(kind: Option<DeclarationKind>) -> &'static str {
    match kind {
        Some(DeclarationKind::Variable) => "Variable",
        Some(DeclarationKind::Parameter) => "Parameter",
        Some(DeclarationKind::FunctionName) => "FunctionName",
        Some(DeclarationKind::ClassName) => "ClassName",
        Some(DeclarationKind::CatchClause) => "CatchClause",
        Some(DeclarationKind::ImportBinding) => "ImportBinding",
        Some(DeclarationKind::TsEnumName) => "TSEnumName",
        Some(DeclarationKind::TsEnumMember) => "TSEnumMemberName",
        Some(DeclarationKind::TsModuleName) => "TSModuleName",
        Some(DeclarationKind::Type) => "Type",
        None => "Other",
    }
}

fn scope_key(scope: Scope, offsets: &Offsets) -> Json {
    string(format!("{}@{}", kind_name(scope.kind()), offsets.of(scope.span().start)))
}

fn symbol_key(symbol: Symbol, offsets: &Offsets) -> Json {
    match symbol.declarations().next().and_then(|it| it.name_span()) {
        Some(name) => number(offsets.of(name.start)),
        None => string(format!("arguments@{}", offsets.of(symbol.scope().span().start))),
    }
}

fn dump_reference(it: Reference, offsets: &Offsets) -> Json {
    let letters = |pairs: [(bool, char); 2]| -> String { pairs.iter().filter(|it| it.0).map(|it| it.1).collect() };
    Json::Array(vec![
        number(offsets.of(it.span().start)),
        string(it.name().bytes()),
        string(letters([(it.is_read(), 'r'), (it.is_write(), 'w')])),
        string(letters([(it.is_value(), 'v'), (it.is_type(), 't')])),
        number(u32::from(it.is_init())),
        it.symbol().map_or(Json::Null, |symbol| symbol_key(symbol, offsets)),
        scope_key(it.scope(), offsets),
        it.write_expr().map_or(Json::Null, |value| number(offsets.of(value.span().start))),
        scope_key(it.node().scope(), offsets),
    ])
}

fn dump<'a>(file: &'a File<'a>) -> Vec<(Vec<u8>, Json)> {
    let offsets = &Offsets::new(file.text());
    let (mut scopes, mut variables) = (Vec::new(), Vec::new());
    for scope in file.scopes() {
        scopes.push(Json::Array(vec![
            string(kind_name(scope.kind())),
            number(offsets.of(scope.span().start)),
            number(offsets.of(scope.span().end)),
            number(u32::from(scope.is_strict())),
            scope.parent().map_or(Json::Null, |it| scope_key(it, offsets)),
            scope_key(scope.variable_scope(), offsets),
        ]));
        for symbol in scope.symbols() {
            let names = symbol.declarations().filter_map(|it| it.name_span());
            variables.push(Json::Array(vec![
                string(symbol.name().bytes()),
                scope_key(scope, offsets),
                Json::Array(names.map(|it| number(offsets.of(it.start))).collect()),
                Json::Array(symbol.declarations().map(|it| string(declaration_kind_name(it.kind()))).collect()),
            ]));
        }
    }
    let references = file.references().map(|it| dump_reference(it, offsets)).collect();
    let mut declared = Vec::new();
    let mut nodes = vec![Node::File(file)];
    while let Some(node) = nodes.pop() {
        node.for_each_child(|child| nodes.push(child));
        // Where ESLint's node starts. `None`: ESLint has no such node, or it is listed as another.
        let start = match node {
            Node::Func(f) => f.scope().map(|it| it.span().start),
            Node::Class(c) => c.scope().map(|it| it.span().start),
            Node::VarDecl(d) => match d.parent() {
                Node::Stmt(s) if matches!(s.kind(), StmtKind::Try { .. }) => None,
                _ => Some(d.span().start),
            },
            Node::TypeParam(p) => match p.parent() {
                Node::Type(t) if matches!(t.kind(), TypeKind::Mapped(_)) => None,
                _ => Some(p.span().start),
            },
            Node::EnumMember(_) | Node::ImportSpec(_) => Some(node.span().start),
            Node::Type(t) if matches!(t.kind(), TypeKind::Mapped(_)) => Some(t.span().start),
            Node::Stmt(s) => match s.kind() {
                StmtKind::Try { block, .. } => Some(bun_lint::tokens::skip_trivia(file.text(), block.span().end)),
                StmtKind::Fn(_) | StmtKind::Class(_) => None,
                StmtKind::Import(_) => Some(s.span().start),
                _ => Some(s.span_without_export().start),
            },
            _ => None,
        };
        let symbols = node.declared_symbols();
        if let (Some(start), false) = (start, symbols.is_empty()) {
            let mut keys: Vec<String> = (symbols.iter())
                .map(|&it| match symbol_key(it, offsets) {
                    Json::Number(n) => format!("{n}"),
                    Json::String(text) => String::from_utf8_lossy(&text).into_owned(),
                    _ => String::new(),
                })
                .collect();
            keys.sort();
            declared.push(Json::Array(vec![number(offsets.of(start)), string(keys.join(","))]));
        }
    }
    vec![
        (b"scopes".to_vec(), Json::Array(scopes)),
        (b"variables".to_vec(), Json::Array(variables)),
        (b"references".to_vec(), Json::Array(references)),
        (b"declared".to_vec(), Json::Array(declared)),
    ]
}

fn language_of(case: &Json) -> LanguageOptions {
    let flag = |key: &[u8]| case.get(key).and_then(Json::as_bool) == Some(true);
    let mut parser_options = Vec::new();
    for key in [&b"jsxPragma"[..], b"jsxFragmentName"] {
        if let Some(value) = case.get(key) {
            parser_options.push((key.to_vec(), value.clone()));
        }
    }
    LanguageOptions {
        ecma_version: match case.get(b"ecmaVersion") {
            Some(&Json::Number(version)) if (6.0..2015.0).contains(&version) => version as u32 + 2009,
            Some(&Json::Number(version)) => version as u32,
            _ => LanguageOptions::LATEST_ECMA_VERSION,
        },
        source_type: match case.get(b"sourceType").and_then(Json::as_str) {
            Some(b"script") => SourceType::Script,
            Some(b"commonjs") => SourceType::CommonJs,
            _ => SourceType::Module,
        },
        global_return: flag(b"globalReturn"),
        implied_strict: flag(b"impliedStrict"),
        jsx: flag(b"jsx"),
        parser_options: Json::Object(parser_options),
        ..LanguageOptions::default()
    }
}

/// `Json::stringify` leaves out `null`.
fn write(value: &Json, out: &mut Vec<u8>) {
    match value {
        Json::Null => out.extend_from_slice(b"null"),
        Json::Array(items) => {
            out.push(b'[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(b',');
                }
                write(item, out);
            }
            out.push(b']');
        }
        Json::Object(fields) => {
            out.push(b'{');
            for (i, (key, item)) in fields.iter().enumerate() {
                if i > 0 {
                    out.push(b',');
                }
                Json::String(key.clone()).stringify(out);
                out.push(b':');
                write(item, out);
            }
            out.push(b'}');
        }
        _ => value.stringify(out),
    }
}

fn print(fields: Vec<(Vec<u8>, Json)>) {
    let mut line = Vec::new();
    write(&Json::Object(fields), &mut line);
    println!("{}", String::from_utf8_lossy(&line));
}

fn dump_case(path: &str, code: &[u8], language: &LanguageOptions) -> Vec<(Vec<u8>, Json)> {
    let dumped = std::panic::catch_unwind(|| {
        crate::with_file(path, code, language, |file| (!file.has_parse_errors()).then(|| dump(file)))
    });
    match dumped {
        Ok(Some(fields)) => fields,
        Ok(None) => vec![(b"error".to_vec(), string("the parser rejects the code"))],
        Err(_) => vec![(b"error".to_vec(), string("panicked"))],
    }
}

fn dump_command(args: &[String]) {
    match args {
        [batch, cases] if batch == "--batch" => {
            std::panic::set_hook(Box::new(|_| {}));
            let cases = std::fs::read(cases).expect("the cases");
            for line in cases.split(|&byte| byte == b'\n').filter(|it| !it.is_empty()) {
                let case = bun_lint::json::parse(line).expect("a case");
                let path = String::from_utf8_lossy(case.get(b"filename").and_then(Json::as_str).unwrap_or(b"file.js"));
                let code = case.get(b"code").and_then(Json::as_str).unwrap_or_default();
                let mut fields = vec![(b"id".to_vec(), case.get(b"id").cloned().unwrap_or(Json::Null))];
                fields.extend(dump_case(&path, code, &language_of(&case)));
                print(fields);
            }
        }
        [path] => print(dump_case(path, &std::fs::read(path).expect("the file"), &LanguageOptions::default())),
        _ => println!("usage: bun-lint semantic dump <file> | bun-lint semantic dump --batch <cases.jsonl>"),
    }
}

fn bench(args: &[String]) {
    let repeat: usize = (args.iter().find_map(|a| a.strip_prefix("--repeat="))).and_then(|n| n.parse().ok()).unwrap_or(1);
    let mut paths = Vec::new();
    for arg in args.iter().filter(|a| !a.starts_with("--")) {
        crate::collect(std::path::Path::new(arg), &mut paths);
    }
    let language = LanguageOptions::default();
    let (mut bytes, mut files, mut counts) = (0usize, 0usize, [0usize; 3]);
    let mut nanos = [0u128; 4];
    for path in &paths {
        let Ok(code) = std::fs::read(path) else {
            continue;
        };
        for _ in 0..repeat {
            let before = std::time::Instant::now();
            crate::with_file(&path.to_string_lossy(), &code, &language, |file| {
                if file.has_parse_errors() {
                    return;
                }
                nanos[0] += before.elapsed().as_nanos();
                (bytes, files) = (bytes + code.len(), files + 1);
                let before = std::time::Instant::now();
                counts[0] += file.scopes().len();
                nanos[1] += before.elapsed().as_nanos();
                let before = std::time::Instant::now();
                counts[1] += file.symbols().count();
                nanos[2] += before.elapsed().as_nanos();
                let before = std::time::Instant::now();
                counts[2] += file.references().len();
                nanos[3] += before.elapsed().as_nanos();
            });
        }
    }
    let megabytes = bytes as f64 / 1e6;
    let per_megabyte = |nanos: u128| nanos as f64 / 1e6 / megabytes;
    println!(
        "{} files, {:.1} MB: {} scopes, {} symbols, {} references",
        files / repeat,
        megabytes / repeat as f64,
        counts[0] / repeat,
        counts[1] / repeat,
        counts[2] / repeat
    );
    println!(
        "ms/MB: parse+bind {:.2}, scopes {:.2}, symbols {:.2}, references {:.2}, all three {:.2}",
        per_megabyte(nanos[0]),
        per_megabyte(nanos[1]),
        per_megabyte(nanos[2]),
        per_megabyte(nanos[3]),
        per_megabyte(nanos[1] + nanos[2] + nanos[3]),
    );
}

pub(crate) fn run(args: &[String]) {
    match args.first().map(String::as_str) {
        Some("dump") => dump_command(&args[1..]),
        Some("bench") => bench(&args[1..]),
        _ => println!("usage: bun-lint semantic dump <file> | dump --batch <cases.jsonl> | bench <paths..>"),
    }
}

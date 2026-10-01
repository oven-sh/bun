// Lint-parse probe outside the worktree: runs Parser::parse_for_lint_with_codes of one tree over sources.
// usage: lintprobe <file>   each line: <loader ts|tsx|js|jsx|dts> TAB <source as hex>
// prints per line: index TAB OK TAB counts   |   index TAB ERR TAB code start end 'reference text' TAB offset length 'bun text' [TAB more messages]
#![allow(unused, non_snake_case)]
#[path = "/workspace/wt/parser/src/js_parser/native_test_shims.rs"]
mod native_test_shims;
mod Macro {
    pub use bun_js_parser::Macro::MacroRemapEntry;
}

use bun_alloc::Arena;
use bun_ast::{Kind, Loader, Log, Source};
use bun_js_parser::defines::Define;
use bun_js_parser::parse::syntax_errors::SyntaxErrors;
use bun_js_parser::{Parser, ParserOptions};

fn unhex(text: &str) -> Vec<u8> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len() / 2);
    let digit = |b: u8| -> u8 {
        match b {
            b'0'..=b'9' => b - b'0',
            b'a'..=b'f' => b - b'a' + 10,
            _ => 0,
        }
    };
    let mut at = 0;
    while at + 1 < bytes.len() {
        out.push(digit(bytes[at]) * 16 + digit(bytes[at + 1]));
        at += 2;
    }
    out
}

/// The source from `at` to the next delimiter: enough to tell which name a key is.
fn word_at(text: &[u8], at: i32) -> String {
    let start = (at.max(0) as usize).min(text.len());
    let mut end = start;
    while end < text.len()
        && end - start < 24
        && !matches!(
            text[end],
            b' ' | b'\n' | b'(' | b':' | b';' | b'=' | b'?' | b'!' | b'<' | b'}' | b',' | b']' | b')'
        )
    {
        end += 1;
    }
    String::from_utf8_lossy(&text[start..end]).into_owned()
}

/// The members that the tree keeps of each class statement of the file: `static kind:name;`.
fn classes(stmts: &[bun_ast::Stmt], text: &[u8]) -> String {
    let mut out = String::new();
    for stmt in stmts {
        let bun_ast::StmtData::SClass(class_stmt) = stmt.data else {
            continue;
        };
        let class = &class_stmt.class;
        out.push_str(" class{");
        for property in class.properties.slice() {
            let kind: &'static str = property.kind.into();
            let is_static = property.flags.contains(bun_ast::flags::Property::IsStatic);
            let name = match property.key {
                Some(key) => word_at(text, key.loc.start),
                None => "-".to_string(),
            };
            out.push_str(if is_static { "static " } else { "" });
            out.push_str(kind);
            out.push(':');
            out.push_str(&name);
            out.push(';');
        }
        out.push('}');
        if class.extends.is_some() {
            out.push_str("+extends");
        }
    }
    out
}

fn describe(log: &Log, errors: &SyntaxErrors) -> String {
    let mut out = String::new();
    let mut shown = 0;
    for (index, msg) in log.msgs.iter().enumerate() {
        if msg.kind != Kind::Err {
            continue;
        }
        if shown == 3 {
            break;
        }
        shown += 1;
        let (offset, length) = msg
            .data
            .location
            .as_ref()
            .map_or((usize::MAX, 0), |location| (location.offset, location.length));
        let reference = match errors.get(index) {
            Some(entry) => format!(
                "TS{} {} {} '{}'",
                entry.code,
                entry.start,
                entry.end,
                String::from_utf8_lossy(&entry.text)
            ),
            None => "nocode".to_string(),
        };
        out.push_str(&format!(
            "\t{} || @{}+{} {}",
            reference,
            offset as i64,
            length,
            String::from_utf8_lossy(&msg.data.text)
        ));
    }
    out
}

fn run(index: usize, loader_name: &str, text: &'static [u8]) {
    let (path, loader): (&'static [u8], Loader) = match loader_name {
        "tsx" => (b"/input.tsx", Loader::Tsx),
        "js" => (b"/input.js", Loader::Js),
        "jsx" => (b"/input.jsx", Loader::Jsx),
        "dts" => (b"/input.d.ts", Loader::Ts),
        _ => (b"/input.ts", Loader::Ts),
    };
    let arena = Arena::new();
    let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
    let _ast_scope = ast_memory_allocator.enter();
    let source = Source::init_path_string(path, text);
    let mut options = ParserOptions::init(Default::default(), loader);
    options.features.no_macros = true;
    options.features.dont_bundle_twice = true;
    if std::env::var_os("LINTPROBE_STANDARD_DECORATORS").is_some() {
        options.features.standard_decorators = true;
    }
    let define = Define::default();
    let mut log = Log::init();
    let mut errors = SyntaxErrors::default();
    let parser = match Parser::init(options, &mut log, &source, &define, &arena) {
        Ok(parser) => parser,
        Err(_) => {
            println!("{index}\tINIT{}", describe(&log, &errors));
            return;
        }
    };
    let result = parser.parse_for_lint_with_codes(&mut errors, |parsed| {
        let attached = &parsed.sidecar.attached;
        let erased = &parsed.sidecar.erased;
        let mut heritage = String::new();
        for record in &attached.heritage {
            heritage.push_str(&format!(
                "[{:?} {}..{} n={}]",
                record.clause.token,
                record.clause.start,
                record.clause.end,
                record.clause.types.items.slice().len()
            ));
        }
        format!(
            "stmts={} ann={} tp={} ret={} this={} kw={} her={}{} erased_stmts={} erased_members={}{}",
            parsed.stmts.len(),
            attached.annotations.len(),
            attached.type_parameters.len(),
            attached.return_types.len(),
            attached.this_parameters.len(),
            attached.keywords.len(),
            attached.heritage.len(),
            heritage,
            erased.statements.len(),
            erased.members.len(),
            classes(parsed.stmts, text)
        )
    });
    match result {
        Ok(counts) => println!("{index}\tOK\t{counts}"),
        Err(_) => println!("{index}\tERR{}", describe(&log, &errors)),
    }
}

fn main() {
    let path = std::env::args().nth(1).expect("usage: lintprobe <file>");
    let file: &'static str = Box::leak(std::fs::read_to_string(path).expect("read").into_boxed_str());
    for (index, line) in file.lines().enumerate() {
        let Some((loader, hex)) = line.split_once('\t') else {
            continue;
        };
        let text: &'static [u8] = Box::leak(unhex(hex).into_boxed_slice());
        run(index, loader, text);
    }
}

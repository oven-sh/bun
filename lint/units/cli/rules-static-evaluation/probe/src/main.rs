//! Research probe of "rules-static-evaluation": `get_static_value` and for-direction as they are to be written, on the tree of `Parser::parse_for_lint`.
//! usage: probe sv <file>...     the static value of each expression statement at the top of a file: `path#index: value`
//!        probe fd <file>...     for-direction: `path(line,col): for-direction: message`
//!        probe syms <file>...   the symbols of the parse pass: `path: kind name`
mod dupe;
mod eslint_utils;
mod for_direction;
mod shims;
mod six;
#[path = "/workspace/wt/cli/src/lint/tokens.rs"]
mod tokens;

use bun_ast::walk::{self, Visitor};
use bun_ast::{Loc, S, StmtData};
use bun_js_parser::parse::parse_entry::ParsedForLint;

use dupe::Ctx;
use eslint_utils::StaticValue;

fn canon(value: Option<StaticValue>) -> String {
    match value {
        None => "none".into(),
        Some(StaticValue::Undefined) => "undefined".into(),
        Some(StaticValue::Null) => "null".into(),
        Some(StaticValue::Boolean(boolean)) => boolean.to_string(),
        Some(StaticValue::Number(number)) if number.is_nan() => "number NaN".into(),
        Some(StaticValue::Number(number)) => format!("number {:016x}", number.to_bits()),
        Some(StaticValue::BigInt(big)) => format!("bigint {big}"),
        Some(StaticValue::String(units)) => format!("string {}", units.iter().map(|unit| format!("{unit:04x}")).collect::<String>()),
        Some(value @ StaticValue::RegExp { .. }) => format!("regexp {}", String::from_utf16_lossy(&eslint_utils::to_string(&value))),
    }
}

struct ForWalk<'c, 'p, 'a> {
    ctx: &'c mut Ctx<'p, 'a>,
}

impl<'ast> Visitor<'ast> for ForWalk<'_, '_, '_> {
    fn visit_s_for(&mut self, node: &'ast S::For, loc: Loc) {
        for_direction::s_for(self.ctx, node, loc);
        walk::walk_s_for(self, node);
    }
}

fn with_parsed(path: &str, f: impl FnOnce(&ParsedForLint<'_, '_>, &bun_ast::Source, &bun_alloc::Arena, &'static [u8])) {
    let Ok(text) = std::fs::read(path) else { return };
    let arena = bun_alloc::Arena::new();
    let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
    let _ast_scope = ast_memory_allocator.enter();
    let text: &'static [u8] = text.leak();
    let source = bun_ast::Source::init_path_string(path.as_bytes().to_vec().leak() as &'static [u8], text);
    let loader = if path.ends_with(".tsx") {
        bun_ast::Loader::Tsx
    } else if path.ends_with("ts") {
        bun_ast::Loader::Ts
    } else {
        bun_ast::Loader::Jsx
    };
    let mut options = bun_js_parser::ParserOptions::init(Default::default(), loader);
    options.features.no_macros = true;
    options.features.is_macro_runtime = true;
    options.features.top_level_await = true;
    options.features.standard_decorators = true;
    let define = bun_js_parser::Define::default();
    let mut log = bun_ast::Log::init();
    let Ok(parser) = bun_js_parser::Parser::init(options, &mut log, &source, &define, &arena) else {
        println!("{path}: PARSE_ERROR");
        return;
    };
    if parser.parse_for_lint(|parsed| f(parsed, &source, &arena, text)).is_err() {
        println!("{path}: PARSE_ERROR");
    }
}

fn main() {
    let mode = std::env::args().nth(1).unwrap_or_default();
    for path in std::env::args().skip(2) {
        with_parsed(&path, |parsed, source, arena, text| match mode.as_str() {
            "sv" => {
                let ctx = Ctx::new(parsed, source, arena);
                println!("{path}: OK");
                for (index, stmt) in parsed.stmts.iter().enumerate() {
                    if let StmtData::SExpr(expr) = &stmt.data {
                        println!("{path}#{index}: {}", canon(eslint_utils::get_static_value(&ctx, &expr.value)));
                    }
                }
            }
            "fd" => {
                let mut ctx = Ctx::new(parsed, source, arena);
                let mut walk = ForWalk { ctx: &mut ctx };
                for stmt in parsed.stmts {
                    walk.visit_stmt(stmt);
                }
                println!("{path}: OK");
                let mut reports = ctx.reports;
                reports.sort();
                reports.dedup();
                for (rule, at, message) in reports {
                    let before = &text[..at as usize];
                    let line = before.iter().filter(|&&b| b == b'\n').count() + 1;
                    let column = before.len() - before.iter().rposition(|&b| b == b'\n').map_or(0, |i| i + 1) + 1;
                    println!("{path}({line},{column}): {rule}: {}", String::from_utf8_lossy(&message));
                }
            }
            _ => {
                println!("{path}: OK");
                for symbol in parsed.symbols {
                    println!("{path}: {} {}", <&'static str>::from(symbol.kind), bstr::BStr::new(symbol.original_name.slice()));
                }
            }
        });
    }
}

//! `bun-lint utils-tsscope ..`
//!
//! - `batch <cases.jsonl>`: for each line `{ id, filename, code, languageOptions }`, what
//!   `bun_lint::utils::ts_scope` says about the code, as a line of JSON in the format of
//!   `test/cli/lint/oracle/utils-tsscope/oracle.ts`. Positions are in bytes.
//! - `bench <cases.jsonl>`: the time that the analyses take for all the cases together.

use bun_lint::ast::walk::{Visitor, walk};
use bun_lint::ast::{ExprKind, FnKind, Func, Node, TypeKind};
use bun_lint::language::LanguageOptions;
use bun_lint::options::{Json, Object};
use bun_lint::span::Span;
use bun_lint::utils::estree_compat::estree_span;
use bun_lint::utils::text::json_stringify;
use bun_lint::utils::ts_scope::{self, ReturnTypeOptions, UsedMarks, Variable};
use std::fmt::Write as _;

struct Functions {
    /// `[start, end, bits, head start, head end]`
    rows: Vec<[i64; 5]>,
    /// `[start, end, is_reference_to_global_function]` of the callees and the type names that are
    /// identifiers.
    globals: Vec<String>,
}

fn row_of(func: Func) -> [i64; 5] {
    let options = ReturnTypeOptions::default();
    let typed = ReturnTypeOptions {
        allow_typed_function_expressions: true,
        ..options
    };
    let expressions = ReturnTypeOptions {
        allow_expressions: true,
        ..options
    };
    let const_assertions = ReturnTypeOptions {
        allow_direct_const_assertion_in_arrow_functions: true,
        ..options
    };
    let higher_order = ReturnTypeOptions {
        allow_higher_order_functions: true,
        ..options
    };
    let is_expression = func.kind() != FnKind::Decl;
    let mut head = None;
    ts_scope::check_function_return_type(func, options, |span| head = Some(span));
    let mut is_reported_as_higher_order = false;
    ts_scope::check_function_return_type(func, higher_order, |_| is_reported_as_higher_order = true);
    let bits = [
        ts_scope::does_immediately_return_function_expression(func),
        is_expression && ts_scope::is_typed_function_expression(func, typed),
        is_expression && ts_scope::is_valid_function_expression_return_type(func, typed),
        is_expression && ts_scope::is_valid_function_expression_return_type(func, expressions),
        is_expression && ts_scope::is_valid_function_expression_return_type(func, const_assertions),
        ts_scope::ancestor_has_return_type(func),
        head.is_some(),
        is_reported_as_higher_order,
    ];
    let bits = bits.iter().enumerate().map(|(i, &bit)| i64::from(bit) << i).sum();
    let span = estree_span(Node::Func(func));
    let head = head.map_or((-1, -1), |it: Span| (i64::from(it.start), i64::from(it.end)));
    [i64::from(span.start), i64::from(span.end), bits, head.0, head.1]
}

impl<'a> Visitor<'a> for Functions {
    fn enter(&mut self, node: Node<'a>) {
        let name = match node {
            Node::Func(func) if func.has_body() && func.kind() != FnKind::StaticBlock => {
                self.rows.push(row_of(func));
                None
            }
            Node::Expr(e) => match e.kind() {
                ExprKind::Call(call) | ExprKind::New(call) => {
                    call.callee().as_ident().map(|name| (name, call.callee().span()))
                }
                _ => None,
            },
            Node::Type(ty) => match ty.kind() {
                TypeKind::Ref { name, .. } => name.as_ident().map(|name| (name.name(), name.span())),
                _ => None,
            },
            _ => None,
        };
        if let Some((name, span)) = name {
            let is_global = u8::from(ts_scope::is_reference_to_global_function(name, node));
            self.globals.push(format!("[{},{},{is_global}]", span.start, span.end));
        }
    }

    fn exit(&mut self, _: Node<'a>) {}
}

fn write_string(out: &mut String, text: &[u8]) {
    let _ = write!(out, "{}", bstr::BStr::new(&json_stringify(text)));
}

fn write_rows(out: &mut String, mut rows: Vec<String>) {
    rows.sort();
    let _ = write!(out, "[{}]", rows.join(","));
}

fn write_variables(out: &mut String, variables: &[Variable]) {
    let rows = variables.iter().map(|variable| {
        let name = variable.defs().next().and_then(|it| it.name_span());
        let mut row = format!("[{},{},", name.map_or(0, |it| it.start), u8::from(variable.class_scope().is_some()));
        write_string(&mut row, variable.name().bytes());
        row.push(']');
        row
    });
    write_rows(out, rows.collect());
}

fn dump(case: Object<'_>) -> String {
    let id = case.number("id").unwrap_or(-1.0);
    let language = LanguageOptions::from_json(case.get("languageOptions").unwrap_or(&Json::Null), &Json::Null);
    let code = case.get("code").and_then(Json::as_str).unwrap_or_default();
    crate::with_file(case.str("filename").unwrap_or("file.ts"), code, &language, |file| {
        if file.has_parse_errors() {
            return format!("{{\"id\":{id},\"error\":true}}");
        }
        let mut out = format!("{{\"id\":{id},\"functions\":");
        let mut functions = Functions {
            rows: Vec::new(),
            globals: Vec::new(),
        };
        walk(file, &mut functions);
        write_rows(&mut out, functions.rows.iter().map(|row| format!("{row:?}").replace(' ', "")).collect());

        let analysis = ts_scope::collect_variables(file, UsedMarks::default());
        out.push_str(",\"unused\":");
        write_variables(&mut out, analysis.unused_variables());
        out.push_str(",\"used\":");
        write_variables(&mut out, analysis.used_variables());

        let usage = ts_scope::analyze_class_member_usage(file, |_| true);
        let members = usage.members().iter().map(|member| {
            let bits = [
                member.is_static(),
                member.is_private(),
                member.is_hash_private(),
                member.is_accessor(),
                member.is_used(),
            ];
            let bits: u32 = bits.iter().enumerate().map(|(i, &bit)| u32::from(bit) << i).sum();
            let span = member.name.name_span;
            let mut row = format!("[{},{},{},{},{bits},", span.start, span.end, member.read_count, member.write_count);
            write_string(&mut row, &member.name.code_name);
            row.push(']');
            row
        });
        out.push_str(",\"members\":");
        write_rows(&mut out, members.collect());
        out.push_str(",\"globals\":");
        write_rows(&mut out, functions.globals);
        out.push('}');
        out
    })
}

/// The time for scopes and references, for `collect_variables` and for `analyze_class_member_usage`.
fn bench(case: Object<'_>, times: &mut [std::time::Duration; 3]) {
    let language = LanguageOptions::from_json(case.get("languageOptions").unwrap_or(&Json::Null), &Json::Null);
    let code = case.get("code").and_then(Json::as_str).unwrap_or_default();
    crate::with_file(case.str("filename").unwrap_or("file.ts"), code, &language, |file| {
        if file.has_parse_errors() {
            return;
        }
        let start = std::time::Instant::now();
        std::hint::black_box(file.symbols().count() + file.references().count());
        times[0] += start.elapsed();
        let start = std::time::Instant::now();
        std::hint::black_box(ts_scope::collect_variables(file, UsedMarks::default()).unused_variables().len());
        times[1] += start.elapsed();
        let start = std::time::Instant::now();
        let usage = ts_scope::analyze_class_member_usage(file, |it| it.is_private() || it.is_hash_private());
        std::hint::black_box(usage.members().len());
        times[2] += start.elapsed();
    });
}

pub(crate) fn run(args: &[String]) {
    let (Some(mode @ ("batch" | "bench")), Some(path)) = (args.first().map(String::as_str), args.get(1)) else {
        println!("usage: bun-lint utils-tsscope batch|bench <cases.jsonl>");
        return;
    };
    let Ok(input) = std::fs::read(path) else {
        println!("cannot read {path}");
        return;
    };
    let mut times = [std::time::Duration::ZERO; 3];
    for line in bun_core::strings::split(&input, b"\n").filter(|line| !line.is_empty()) {
        match bun_lint::json::parse(line) {
            Some(case) if mode == "bench" => bench(Object::of(Some(&case)), &mut times),
            Some(case) => println!("{}", dump(Object::of(Some(&case)))),
            None => println!("{{\"error\":true}}"),
        }
    }
    if mode == "bench" {
        println!("scopes and references {:?}, collect_variables {:?}, analyze_class_member_usage {:?}", times[0], times[1], times[2]);
    }
}

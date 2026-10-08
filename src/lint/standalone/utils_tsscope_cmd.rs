//! `bun-lint utils-tsscope ..`
//!
//! - `batch <cases.jsonl>`: for each line `{ id, filename, code, sourceType?, parserOptions? }`, what
//!   `bun_lint::utils::ts_scope` says about the code, as a line of JSON in the format of
//!   `test/cli/lint/oracle/utils-tsscope/oracle.ts`. Positions are in bytes.

use bun_lint::ast::walk::{Visitor, walk};
use bun_lint::ast::{FnKind, Func, Node};
use bun_lint::language::{LanguageOptions, SourceType};
use bun_lint::options::{Json, Object};
use bun_lint::span::Span;
use bun_lint::utils::estree_compat::estree_span;
use bun_lint::utils::text::json_stringify;
use bun_lint::utils::ts_scope::{self, ReturnTypeOptions, UsedMarks, Variable};
use std::fmt::Write as _;

struct Functions {
    /// `[start, end, bits, head start, head end]`
    rows: Vec<[i64; 5]>,
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
        if let Node::Func(func) = node
            && func.has_body()
            && func.kind() != FnKind::StaticBlock
        {
            self.rows.push(row_of(func));
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
    let language = LanguageOptions {
        source_type: match case.str("sourceType") {
            Some("script") => SourceType::Script,
            Some("commonjs") => SourceType::CommonJs,
            _ => SourceType::Module,
        },
        parser_options: case.get("parserOptions").cloned().unwrap_or(Json::Null),
        ..LanguageOptions::default()
    };
    let code = case.get("code").and_then(Json::as_str).unwrap_or_default();
    crate::with_file(case.str("filename").unwrap_or("file.ts"), code, &language, |file| {
        if file.has_parse_errors() {
            return format!("{{\"id\":{id},\"error\":true}}");
        }
        let mut out = format!("{{\"id\":{id},\"functions\":");
        let mut functions = Functions { rows: Vec::new() };
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
        out.push('}');
        out
    })
}

pub(crate) fn run(args: &[String]) {
    let (Some("batch"), Some(path)) = (args.first().map(String::as_str), args.get(1)) else {
        println!("usage: bun-lint utils-tsscope batch <cases.jsonl>");
        return;
    };
    let Ok(input) = std::fs::read(path) else {
        println!("cannot read {path}");
        return;
    };
    for line in bun_core::strings::split(&input, b"\n").filter(|line| !line.is_empty()) {
        match bun_lint::json::parse(line) {
            Some(case) => println!("{}", dump(Object::of(Some(&case)))),
            None => println!("{{\"error\":true}}"),
        }
    }
}

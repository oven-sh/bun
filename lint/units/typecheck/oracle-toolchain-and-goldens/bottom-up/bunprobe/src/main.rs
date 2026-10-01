//! Research probe: the tree of `bun_js_parser::Parser::parse_only`, one node per line, in source order of the walk
//! of `bun_ast::walk`. A line is `<indent><tag> <start>[ <detail>]`: the tag is the variant name of `bun_ast`, the
//! start is `loc.start` in bytes. usage: bunparseonly <virtual-name>=<path>...
mod native;
mod shims;

use bun_ast::expr::Data as ExprData;
use bun_ast::walk::{self, Visitor};
use bun_ast::{B, Binding, E, Expr, Loc, Ref, Stmt};
use std::fmt::Write as _;

struct Printer<'p> {
    name_of: &'p dyn Fn(Ref) -> String,
    depth: usize,
    out: String,
}

impl Printer<'_> {
    fn line(&mut self, tag: &str, start: i32, detail: &str) {
        let _ = writeln!(self.out, "{:indent$}{tag} {start}{detail}", "", indent = self.depth * 2);
    }
}

fn text(bytes: &[u8]) -> String {
    format!("{:?}", String::from_utf8_lossy(bytes))
}

impl<'ast> Visitor<'ast> for Printer<'_> {
    fn visit_stmt(&mut self, stmt: &'ast Stmt) {
        let tag: &'static str = stmt.data.tag().into();
        self.line(tag, stmt.loc.start, "");
        self.depth += 1;
        walk::walk_stmt(self, stmt);
        self.depth -= 1;
    }

    fn visit_expr(&mut self, expr: &'ast Expr) {
        let tag: &'static str = expr.data.tag().into();
        let detail = match &expr.data {
            ExprData::EIdentifier(e) => format!(" name={:?}", (self.name_of)(e.ref_)),
            ExprData::EString(e) if e.is_utf8() && e.next.is_none() => format!(" text={}", text(e.slice8())),
            ExprData::ENumber(e) => format!(" value={}", e.value()),
            ExprData::EDot(e) => format!(" name={}", text(e.name.slice())),
            ExprData::EBinary(e) => {
                let op: &'static str = e.op.into();
                format!(" op={op}")
            }
            ExprData::EUnary(e) => {
                let op: &'static str = e.op.into();
                format!(" op={op}")
            }
            _ => String::new(),
        };
        self.line(tag, expr.loc.start, &detail);
        self.depth += 1;
        walk::walk_expr(self, expr);
        self.depth -= 1;
    }

    // Operands in source order; a left operand that is a binary expression is printed like any other expression.
    fn visit_e_binary(&mut self, node: &'ast E::Binary, _loc: Loc) -> Option<&'ast Expr> {
        self.visit_expr(&node.left);
        self.visit_expr(&node.right);
        None
    }

    fn visit_binding(&mut self, binding: &'ast Binding) {
        let (tag, detail) = match &binding.data {
            B::B::BIdentifier(b) => ("b_identifier", format!(" name={:?}", (self.name_of)(b.r#ref))),
            B::B::BArray(_) => ("b_array", String::new()),
            B::B::BObject(_) => ("b_object", String::new()),
            B::B::BMissing(_) => ("b_missing", String::new()),
        };
        self.line(tag, binding.loc.start, &detail);
        self.depth += 1;
        walk::walk_binding(self, binding);
        self.depth -= 1;
    }
}

fn dump(name: &str, contents: &[u8]) -> String {
    let arena = bun_alloc::Arena::new();
    let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
    let _ast_scope = ast_memory_allocator.enter();
    let source = bun_ast::Source::init_path_string(name.as_bytes(), contents);
    let loader = if name.ends_with(".tsx") {
        bun_ast::Loader::Tsx
    } else if name.ends_with(".ts") || name.ends_with(".mts") || name.ends_with(".cts") {
        bun_ast::Loader::Ts
    } else if name.ends_with(".jsx") {
        bun_ast::Loader::Jsx
    } else {
        bun_ast::Loader::Js
    };
    let mut options = bun_js_parser::ParserOptions::init(Default::default(), loader);
    options.features.no_macros = true;
    options.features.top_level_await = true;
    options.suppress_warnings_about_weird_code = true;
    let define = bun_js_parser::Define::default();
    let mut log = bun_ast::Log::init();
    let mut out = format!("file {name} bytes={}\n", contents.len());
    let Ok(parser) = bun_js_parser::Parser::init(options, &mut log, &source, &define, &arena) else {
        out.push_str("error: the parser did not start\n");
        return out;
    };
    let result = parser.parse_only(|parsed| {
        let name_of = |r: Ref| String::from_utf8_lossy(parsed.name_of(r)).into_owned();
        let mut printer = Printer { name_of: &name_of, depth: 0, out: String::new() };
        for stmt in parsed.stmts {
            printer.visit_stmt(stmt);
        }
        printer.out
    });
    match result {
        Ok(tree) => out.push_str(&tree),
        Err(_) => {
            let _ = writeln!(out, "error: does not parse (errors={})", log.errors);
        }
    }
    out
}

fn main() {
    for arg in std::env::args().skip(1) {
        let Some((name, path)) = arg.split_once('=') else {
            eprintln!("usage: bunparseonly <virtual-name>=<path>...");
            std::process::exit(2);
        };
        match std::fs::read(path) {
            Ok(contents) => print!("{}", dump(name, &contents)),
            Err(error) => {
                eprintln!("{path}: {error}");
                std::process::exit(1);
            }
        }
    }
}

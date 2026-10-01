//! Research probe: what `Parser::parse_for_lint` leaves for the rules on expression shape.
//! usage: probe <file>...   for each file: every statement and expression of the walk, with the wrapper records that name it,
//!                          then the records that no expression of the walk is the operand of.
//!        probe dupe <file>...   no-dupe-else-if as it is to be written, on the tree and the records of a lint parse and on
//!                          the scanner of src/lint/tokens.rs: prints `path(line,col): no-dupe-else-if` for each report.
mod dupe;
mod shims;
#[path = "/workspace/wt/cli/src/lint/tokens.rs"]
mod tokens;

use bun_ast::walk::{self, Visitor};
use bun_ast::{Expr, ExprData, Loc, Stmt, StmtData, E};
use bun_js_parser::parse::parse_entry::ParsedForLint;
use bun_js_parser::parse::wrappers::{ExprId, Wrapper, WrapperData};

struct Dump<'p, 'a> {
    parsed: &'p ParsedForLint<'p, 'a>,
    seen: Vec<bool>,
    out: String,
}

fn at(expr: &Expr) -> String {
    format!("{}@{}", <&'static str>::from(expr.data.tag()), expr.loc.start)
}

fn chain(chain: Option<bun_ast::OptionalChain>) -> &'static str {
    match chain {
        None => "none",
        Some(chain) => chain.into(),
    }
}

impl Dump<'_, '_> {
    fn wrappers(&mut self, expr: &Expr) -> String {
        let id = ExprId::of(expr);
        let mut out = String::new();
        let records: &[Wrapper] = &self.parsed.sidecar.wrappers.records;
        for (index, record) in records.iter().enumerate() {
            if ExprId::of(&record.operand) == id {
                self.seen[index] = true;
                let kind = match record.data {
                    WrapperData::As(_) => "As",
                    WrapperData::Satisfies(_) => "Satisfies",
                    WrapperData::NonNull => "NonNull",
                    WrapperData::TypeAssertion(_) => "TypeAssertion",
                    WrapperData::Parenthesized => "Paren",
                };
                out.push_str(&format!(" {kind}[{},{})", record.op, record.end));
            }
        }
        out
    }
}

impl<'ast> Visitor<'ast> for Dump<'_, '_> {
    fn enter_stmt(&mut self, stmt: &'ast Stmt) {
        let detail = match &stmt.data {
            StmtData::SIf(node) => format!(
                " test={} no={}",
                at(&node.test),
                node.no.as_ref().map_or("-".to_owned(), |no| <&'static str>::from(no.data.tag()).to_owned())
            ),
            StmtData::SFor(node) => format!(" test={}", node.test.as_ref().map_or("-".to_owned(), at)),
            StmtData::SWhile(node) => format!(" test={}", at(&node.test)),
            StmtData::SDoWhile(node) => format!(" test={}", at(&node.test)),
            _ => String::new(),
        };
        self.out.push_str(&format!("S {}@{}{detail}\n", <&'static str>::from(stmt.data.tag()), stmt.loc.start));
    }

    fn enter_expr(&mut self, expr: &'ast Expr) {
        let detail = match &expr.data {
            ExprData::EBinary(node) => format!(" op={} left={} right={}", <&'static str>::from(node.op), at(&node.left), at(&node.right)),
            ExprData::EUnary(node) => format!(" op={} value={}", <&'static str>::from(node.op), at(&node.value)),
            ExprData::EDot(node) => format!(" .{} chain={} target={}", bstr::BStr::new(node.name.slice()), chain(node.optional_chain), at(&node.target)),
            ExprData::EIndex(node) => format!(" chain={} target={} index={}", chain(node.optional_chain), at(&node.target), at(&node.index)),
            ExprData::ECall(node) => format!(" chain={} target={} args={} close={}", chain(node.optional_chain), at(&node.target), node.args.len(), node.close_paren_loc.start),
            ExprData::ENew(node) => format!(" target={} args={} close={}", at(&node.target), node.args.len(), node.close_parens_loc.start),
            ExprData::EIf(node) => format!(" test={} yes={} no={}", at(&node.test), at(&node.yes), at(&node.no)),
            ExprData::EIdentifier(node) => format!(" name={}", bstr::BStr::new(self.parsed.name_of(node.ref_))),
            ExprData::EString(node) => format!(" template={} len={}", node.prefer_template, node.len()),
            ExprData::ETemplate(node) => {
                let head = match &node.head {
                    E::TemplateContents::Cooked(cooked) => format!("cooked:{}", cooked.len()),
                    E::TemplateContents::Raw(raw) => format!("raw:{}", raw.slice().len()),
                };
                let tails: Vec<String> = node
                    .parts
                    .slice()
                    .iter()
                    .map(|part| match &part.tail {
                        E::TemplateContents::Cooked(cooked) => format!("cooked:{}", cooked.len()),
                        E::TemplateContents::Raw(raw) => format!("raw:{}", raw.slice().len()),
                    })
                    .collect();
                format!(" tag={} head={head} tails={tails:?}", node.tag.as_ref().map_or("-".to_owned(), at))
            }
            ExprData::ENumber(node) => format!(" value={}", node.value()),
            ExprData::EBoolean(node) => format!(" value={}", node.value),
            ExprData::EBigInt(node) => format!(" text={}", bstr::BStr::new(node.value.slice())),
            ExprData::ESpread(node) => format!(" value={}", at(&node.value)),
            ExprData::EArray(node) => format!(" items={} parenthesized={}", node.items.len(), node.is_parenthesized),
            ExprData::EFunction(node) => format!(" flags={:?}", node.func.flags),
            ExprData::EYield(node) => format!(" star={} value={}", node.is_star, node.value.as_ref().map_or("-".to_owned(), at)),
            _ => String::new(),
        };
        let wrappers = self.wrappers(expr);
        self.out.push_str(&format!("  E {}{detail}{}{wrappers}\n", at(expr), if wrappers.is_empty() { "" } else { "  <=" }));
    }

    fn visit_e_binary(&mut self, node: &'ast E::Binary, _: Loc) -> Option<&'ast Expr> {
        walk::walk_e_binary(self, node)
    }
}

fn dump(path: &str) -> Option<String> {
    let text = std::fs::read(path).ok()?;
    let arena = bun_alloc::Arena::new();
    let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
    let _ast_scope = ast_memory_allocator.enter();
    let source = bun_ast::Source::init_path_string(path.as_bytes().to_vec().leak() as &'static [u8], text.leak() as &'static [u8]);
    let loader = if path.ends_with(".tsx") {
        bun_ast::Loader::Tsx
    } else if path.ends_with("ts") {
        bun_ast::Loader::Ts
    } else if path.ends_with(".mjs") || path.ends_with(".cjs") {
        bun_ast::Loader::Js
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
    let parser = bun_js_parser::Parser::init(options, &mut log, &source, &define, &arena).ok()?;
    let result = parser.parse_for_lint(|parsed| {
        let mut dump = Dump { parsed, seen: vec![false; parsed.sidecar.wrappers.records.len()], out: String::new() };
        for stmt in parsed.stmts {
            dump.visit_stmt(stmt);
        }
        let mut out = dump.out;
        for (index, record) in parsed.sidecar.wrappers.records.iter().enumerate() {
            if !dump.seen[index] {
                out.push_str(&format!("UNMATCHED {} [{},{}) of {}\n", record.data.kind_name(), record.op, record.end, at(&record.operand)));
            }
        }
        out.push_str(&format!("records={} symbols={}\n", parsed.sidecar.wrappers.records.len(), parsed.symbols.len()));
        for symbol in parsed.symbols {
            out.push_str(&format!("  symbol {} {}\n", <&'static str>::from(symbol.kind), bstr::BStr::new(symbol.original_name.slice())));
        }
        out
    });
    match result {
        Ok(out) => Some(out),
        Err(_) => {
            let mut out = String::from("PARSE_ERROR\n");
            for msg in &log.msgs {
                out.push_str(&format!("  {}\n", bstr::BStr::new(&msg.data.text)));
            }
            Some(out)
        }
    }
}

fn main() {
    if std::env::args().nth(1).as_deref() == Some("dupe") {
        for path in std::env::args().skip(2) {
            dupe::run(&path);
        }
        return;
    }
    for path in std::env::args().skip(1) {
        println!("== {path}");
        match dump(&path) {
            Some(out) => print!("{out}"),
            None => println!("CANNOT_READ_OR_INIT"),
        }
    }
}

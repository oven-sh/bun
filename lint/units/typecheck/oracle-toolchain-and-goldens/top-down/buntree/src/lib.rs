//! Research probe: the statements of `Parser::parse_only` as an indented tree, one node per line.
//! A line is `<kind> @<loc.start>` plus the name of an identifier. Children follow in the order of `bun_ast::walk`
//! (a binary expression gives its right operand before its left one, and the left spine of a chain stays at one depth).
//! `Parser::parse_only` is `P<false, false>` at e3566be889: it parses JavaScript, and type syntax is a parse error.

use bun_ast::walk::{self, Visitor};
use bun_ast::binding::Data as BindingData;
use bun_ast::{Binding, Expr, Stmt};
use bun_js_parser::parse::parse_entry::ParsedOnly;

struct Dump<'p, 'q, 'a> {
    out: String,
    depth: usize,
    parsed: &'p ParsedOnly<'q, 'a>,
}

impl Dump<'_, '_, '_> {
    fn line(&mut self, kind: &str, start: i32, extra: &[u8]) {
        for _ in 0..self.depth {
            self.out.push_str("  ");
        }
        self.out.push_str(kind);
        self.out.push_str(" @");
        self.out.push_str(&start.to_string());
        if !extra.is_empty() {
            self.out.push(' ');
            self.out.push_str(&String::from_utf8_lossy(extra));
        }
        self.out.push('\n');
    }
}

impl<'ast> Visitor<'ast> for Dump<'_, '_, '_> {
    fn visit_stmt(&mut self, stmt: &'ast Stmt) {
        self.depth += 1;
        walk::walk_stmt(self, stmt);
        self.depth -= 1;
    }
    fn visit_expr(&mut self, expr: &'ast Expr) {
        self.depth += 1;
        walk::walk_expr(self, expr);
        self.depth -= 1;
    }
    fn visit_binding(&mut self, binding: &'ast Binding) {
        self.depth += 1;
        walk::walk_binding(self, binding);
        self.depth -= 1;
    }
    fn enter_stmt(&mut self, stmt: &'ast Stmt) {
        let kind: &'static str = stmt.data.tag().into();
        self.line(kind, stmt.loc.start, b"");
    }
    fn enter_expr(&mut self, expr: &'ast Expr) {
        let kind: &'static str = expr.data.tag().into();
        let name: &[u8] = match &expr.data {
            bun_ast::expr::Data::EIdentifier(e) => self.parsed.name_of(e.ref_),
            _ => b"",
        };
        self.line(kind, expr.loc.start, name);
    }
    fn enter_binding(&mut self, binding: &'ast Binding) {
        let (kind, name): (&str, &[u8]) = match &binding.data {
            BindingData::BIdentifier(b) => ("b_identifier", self.parsed.name_of(b.r#ref)),
            BindingData::BArray(_) => ("b_array", b""),
            BindingData::BObject(_) => ("b_object", b""),
            BindingData::BMissing(_) => ("b_missing", b""),
        };
        self.line(kind, binding.loc.start, name);
    }
}

/// The tree of `text`, or the reason it has none. `name` picks the loader by its extension.
pub fn dump(name: &str, text: &[u8]) -> String {
    let loader = if name.ends_with(".tsx") {
        bun_ast::Loader::Tsx
    } else if name.ends_with(".jsx") {
        bun_ast::Loader::Jsx
    } else if name.ends_with(".js") || name.ends_with(".mjs") || name.ends_with(".cjs") {
        bun_ast::Loader::Js
    } else {
        bun_ast::Loader::Ts
    };
    let arena = bun_alloc::Arena::new();
    let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
    let _ast_scope = ast_memory_allocator.enter();
    let source = bun_ast::Source::init_path_string(name.as_bytes(), text);
    let mut options = bun_js_parser::ParserOptions::init(Default::default(), loader);
    options.features.no_macros = true;
    options.features.top_level_await = true;
    options.suppress_warnings_about_weird_code = true;
    let define = bun_js_parser::Define::default();
    let mut log = bun_ast::Log::init();
    let parser = match bun_js_parser::Parser::init(options, &mut log, &source, &define, &arena) {
        Ok(parser) => parser,
        Err(_) => return format!("file {name} bytes={} error=init errors={}\n", text.len(), log.errors),
    };
    let result = parser.parse_only(|parsed| {
        let mut d = Dump { out: String::new(), depth: 0, parsed };
        for stmt in parsed.stmts {
            walk::walk_stmt(&mut d, stmt);
        }
        (parsed.stmts.len(), d.out)
    });
    match result {
        Ok((count, tree)) => format!("file {name} bytes={} statements={count}\n{tree}", text.len()),
        Err(_) => {
            let mut out = format!("file {name} bytes={} error=parse errors={}\n", text.len(), log.errors);
            for msg in &log.msgs {
                out.push_str("  ");
                out.push_str(&String::from_utf8_lossy(&msg.data.text));
                out.push('\n');
            }
            out
        }
    }
}

#[cfg(test)]
mod native_shims;

#[cfg(test)]
mod tests {
    /// `BUNTREE_ARGS` holds `<name>=<path>` pairs separated by spaces, `BUNTREE_OUT` the output directory.
    #[test]
    fn dump_files() {
        let Ok(args) = std::env::var("BUNTREE_ARGS") else {
            // parse_only is P<false, false> at this commit: JavaScript. Type syntax is a parse error.
            let tree = super::dump("min.js", b"const x = \"s\";\nf(a + b + c, y => y.z);\n");
            print!("{tree}");
            assert!(tree.starts_with("file min.js bytes=39 statements=2\n"), "{tree}");
            print!("{}", super::dump("min.ts", b"const x: number = \"s\";\n"));
            return;
        };
        let out = std::env::var("BUNTREE_OUT").expect("BUNTREE_OUT");
        for pair in args.split_whitespace() {
            let (name, path) = pair.split_once('=').expect("name=path");
            let text = std::fs::read(path).expect("read");
            let text = text.strip_prefix(b"\xef\xbb\xbf").unwrap_or(&text);
            let tree = super::dump(name, text);
            std::fs::write(format!("{out}/{}.bun.txt", name.replace('/', "__")), tree).expect("write");
        }
    }
}

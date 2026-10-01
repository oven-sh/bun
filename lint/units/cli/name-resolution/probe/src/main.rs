//! Research probe of "name-resolution": what `Parser::parse_for_lint` leaves of scopes, symbols and names.
//! usage: nrprobe <file>...
//! For each file: `scopes_in_order` (read through a transmute, because `ScopeOrder::loc`/`scope` are pub(crate)),
//! the symbol table, and every node of the walk that holds a `Ref`, with the tag of that `Ref`.
//! Nothing here is for the tree: the transmute is what a probe may do and the crate may not.
mod shims;

use bun_ast::walk::{self, Visitor};
use bun_ast::{B, E, Expr, ExprData, G, Loc, Ref, S, Scope, Stmt, StmtData};
use bun_js_parser::parse::parse_entry::ParsedForLint;

fn tag(r: Ref) -> &'static str {
    <&'static str>::from(r.tag())
}

struct Dump<'p, 'a> {
    parsed: &'p ParsedForLint<'p, 'a>,
    out: String,
    depth: usize,
}

impl Dump<'_, '_> {
    fn r(&self, r: Ref) -> String {
        let name = self.parsed.name_of(r);
        match r.tag() {
            bun_ast::RefTag::Symbol => {
                let symbol = self.parsed.symbols.get(r.inner_index() as usize);
                let kind = symbol.map_or("?", |s| <&'static str>::from(s.kind));
                format!("sym#{}:{}:{}", r.inner_index(), kind, bstr::BStr::new(name))
            }
            other => format!("{}:{}", <&'static str>::from(other), bstr::BStr::new(name)),
        }
    }
    fn line(&mut self, text: String) {
        for _ in 0..self.depth {
            self.out.push_str("  ");
        }
        self.out.push_str(&text);
        self.out.push('\n');
    }
    fn func(&mut self, what: &str, func: &G::Fn, loc: Loc) {
        let name = func.name.map_or("-".to_owned(), |n| format!("{}@{}", self.r(n.ref_), n.loc.start));
        let args = self.r(func.arguments_ref);
        self.line(format!(
            "{what}@{} name={name} open_parens={} body_loc={} arguments_ref={} ({}) flags={:?}",
            loc.start,
            func.open_parens_loc.start,
            func.body.loc.start,
            args,
            tag(func.arguments_ref),
            func.flags
        ));
    }
    fn class(&mut self, what: &str, class: &G::Class, loc: Loc) {
        let name = class.class_name.map_or("-".to_owned(), |n| format!("{}@{}", self.r(n.ref_), n.loc.start));
        self.line(format!(
            "{what}@{} name={name} keyword={} body_loc={} close={}",
            loc.start, class.class_keyword.loc.start, class.body_loc.start, class.close_brace_loc.start
        ));
        for property in class.properties.slice() {
            let key = property.key.as_ref().map_or("-".to_owned(), |k| format!("{}@{}", <&'static str>::from(k.data.tag()), k.loc.start));
            let block = property.class_static_block.as_ref().map_or("-".to_owned(), |b| format!("static@{}", b.loc.start));
            self.line(format!(
                "  member kind={:?} key={key} value={} initializer={} {block} flags={:?}",
                property.kind as u8,
                property.value.as_ref().map_or("-".to_owned(), |v| format!("{}@{}", <&'static str>::from(v.data.tag()), v.loc.start)),
                property.initializer.as_ref().map_or("-".to_owned(), |v| format!("{}@{}", <&'static str>::from(v.data.tag()), v.loc.start)),
                property.flags
            ));
        }
    }
}

impl<'ast> Visitor<'ast> for Dump<'_, '_> {
    fn visit_stmt(&mut self, stmt: &'ast Stmt) {
        let detail = match &stmt.data {
            StmtData::SLocal(node) => format!(" kind={} export={}", <&'static str>::from(node.kind), node.is_export),
            StmtData::SLabel(node) => format!(" label={}@{}", self.r(node.name.ref_), node.name.loc.start),
            StmtData::SBreak(node) => node.label.map_or(String::new(), |l| format!(" label={}@{}", self.r(l.ref_), l.loc.start)),
            StmtData::SContinue(node) => node.label.map_or(String::new(), |l| format!(" label={}@{}", self.r(l.ref_), l.loc.start)),
            StmtData::SImport(node) => {
                let mut s = format!(" ns={}@{}", self.r(node.namespace_ref), node.star_name_loc.start);
                if let Some(d) = node.default_name {
                    s.push_str(&format!(" default={}@{}", self.r(d.ref_), d.loc.start));
                }
                for item in node.items.slice() {
                    s.push_str(&format!(" item[{} as {}@{}]", bstr::BStr::new(item.alias.slice()), self.r(item.name.ref_), item.name.loc.start));
                }
                s
            }
            StmtData::SExportClause(node) => {
                let mut s = String::new();
                for item in node.items.slice() {
                    s.push_str(&format!(" item[{}@{} as {}@{}]", self.r(item.name.ref_), item.name.loc.start, bstr::BStr::new(item.alias.slice()), item.alias_loc.start));
                }
                s
            }
            StmtData::SExportFrom(node) => {
                let mut s = format!(" ns={}", self.r(node.namespace_ref));
                for item in node.items.slice() {
                    s.push_str(&format!(" item[{}@{} as {}]", self.r(item.name.ref_), item.name.loc.start, bstr::BStr::new(item.alias.slice())));
                }
                s
            }
            StmtData::SExportStar(node) => format!(" ns={}", self.r(node.namespace_ref)),
            StmtData::SExportDefault(node) => format!(" default_name={}@{}", self.r(node.default_name.ref_), node.default_name.loc.start),
            StmtData::SEnum(node) => {
                let mut s = format!(" name={}@{} arg={}", self.r(node.name.ref_), node.name.loc.start, self.r(node.arg));
                for value in node.values.slice() {
                    s.push_str(&format!(" value[{}@{} {}]", bstr::BStr::new(value.name.slice()), value.loc.start, self.r(value.ref_)));
                }
                s
            }
            StmtData::SNamespace(node) => format!(" name={}@{} arg={} export={}", self.r(node.name.ref_), node.name.loc.start, self.r(node.arg), node.is_export),
            StmtData::STry(node) => {
                let mut s = format!(" body_loc={}", node.body_loc.start);
                if let Some(catch) = &node.catch {
                    s.push_str(&format!(" catch@{} body_loc={}", catch.loc.start, catch.body_loc.start));
                }
                if let Some(finally) = &node.finally {
                    s.push_str(&format!(" finally@{}", finally.loc.start));
                }
                s
            }
            StmtData::SSwitch(node) => format!(" body_loc={}", node.body_loc.start),
            StmtData::SWith(node) => format!(" body_loc={}", node.body_loc.start),
            _ => String::new(),
        };
        self.line(format!("S {}@{}{detail}", <&'static str>::from(stmt.data.tag()), stmt.loc.start));
        self.depth += 1;
        walk::walk_stmt(self, stmt);
        self.depth -= 1;
    }

    fn visit_expr(&mut self, expr: &'ast Expr) {
        let detail = match &expr.data {
            ExprData::EIdentifier(node) => format!(" {}", self.r(node.ref_)),
            ExprData::EPrivateIdentifier(node) => format!(" {}", self.r(node.ref_)),
            ExprData::EDot(node) => format!(" .{}", bstr::BStr::new(node.name.slice())),
            ExprData::EBinary(node) => format!(" op={}", <&'static str>::from(node.op)),
            ExprData::EUnary(node) => format!(" op={}", <&'static str>::from(node.op)),
            ExprData::EString(node) => format!(" len={}", node.len()),
            ExprData::ECall(node) => format!(" direct_eval={}", node.is_direct_eval),
            ExprData::EArrow(node) => format!(" body_loc={} prefer_expr={} args={}", node.body.loc.start, node.prefer_expr, node.args.len()),
            _ => String::new(),
        };
        self.line(format!("E {}@{}{detail}", <&'static str>::from(expr.data.tag()), expr.loc.start));
        self.depth += 1;
        walk::walk_expr(self, expr);
        self.depth -= 1;
    }

    fn visit_binding(&mut self, binding: &'ast bun_ast::Binding) {
        let detail = match &binding.data {
            B::B::BIdentifier(node) => format!(" {}", self.r(node.r#ref)),
            _ => String::new(),
        };
        let kind = match &binding.data {
            B::B::BIdentifier(_) => "b_identifier",
            B::B::BArray(_) => "b_array",
            B::B::BObject(_) => "b_object",
            B::B::BMissing(_) => "b_missing",
        };
        self.line(format!("B {kind}@{}{detail}", binding.loc.start));
        self.depth += 1;
        walk::walk_binding(self, binding);
        self.depth -= 1;
    }

    fn visit_s_function(&mut self, node: &'ast S::Function, loc: Loc) {
        self.func("fn-stmt", &node.func, loc);
        walk::walk_s_function(self, node);
    }
    fn visit_e_function(&mut self, node: &'ast E::Function, loc: Loc) {
        self.func("fn-expr", &node.func, loc);
        walk::walk_e_function(self, node);
    }
    fn visit_s_class(&mut self, node: &'ast S::Class, loc: Loc) {
        self.class("class-stmt", &node.class, loc);
        walk::walk_s_class(self, node);
    }
    fn visit_e_class(&mut self, node: &'ast E::Class, loc: Loc) {
        self.class("class-expr", node, loc);
        walk::walk_e_class(self, node);
    }
    fn visit_e_binary(&mut self, node: &'ast E::Binary, _: Loc) -> Option<&'ast Expr> {
        walk::walk_e_binary(self, node)
    }
}

/// The two private fields of a `ScopeOrder`, found by what they look like: the address of the scope and the offset.
fn order_fields<T: Copy>(order: &T) -> Option<(i32, *const Scope)> {
    if core::mem::size_of::<T>() != 16 {
        return None;
    }
    // SAFETY: `T` is `ScopeOrder`, 16 bytes of plain data: a pointer and an `i32` with padding.
    let words: [u64; 2] = unsafe { core::ptr::read_unaligned(core::ptr::from_ref(order).cast::<[u64; 2]>()) };
    let (pointer, other) = if words[0] > 0x1_0000_0000 { (words[0], words[1]) } else { (words[1], words[0]) };
    Some((other as u32 as i32, pointer as usize as *const Scope))
}

fn dump(path: &str, tree: bool) -> Option<String> {
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
        let mut out = String::new();
        out.push_str(&format!("stmts={} scopes_in_order={} symbols={} erased={}\n", parsed.stmts.len(), parsed.scopes_in_order.len(), parsed.symbols.len(), parsed.sidecar.erased.statements.len()));
        // The scopes, by the address of each.
        let mut addresses: Vec<(usize, i32)> = Vec::new();
        for entry in parsed.scopes_in_order {
            if let Some(order) = entry
                && let Some((loc, scope)) = order_fields(order)
            {
                addresses.push((scope as usize, loc));
            }
        }
        let mut previous = i32::MIN;
        for (index, entry) in parsed.scopes_in_order.iter().enumerate() {
            let Some(order) = entry else {
                out.push_str(&format!("scope[{index}] None\n"));
                continue;
            };
            let Some((loc, scope)) = order_fields(order) else {
                out.push_str(&format!("scope[{index}] ?\n"));
                continue;
            };
            // SAFETY: the scope is in the arena of the parse, which lives until the closure returns.
            let scope: &Scope = unsafe { &*scope };
            let parent = scope.parent.map_or("-".to_owned(), |p| {
                let address = p.as_ptr() as usize;
                addresses.iter().find(|(a, _)| *a == address).map_or("NOT-IN-ORDER".to_owned(), |(_, l)| l.to_string())
            });
            let order_note = if loc <= previous { " NOT-INCREASING" } else { "" };
            previous = loc;
            let children: Vec<String> = scope
                .children
                .iter()
                .map(|c| {
                    let address = c.as_ptr() as usize;
                    addresses.iter().find(|(a, _)| *a == address).map_or(format!("discarded:{}", <&'static str>::from(c.kind)), |(_, l)| l.to_string())
                })
                .collect();
            out.push_str(&format!(
                "scope[{index}] loc={loc} kind={} parent={parent} strict={:?} children={children:?} generated={} forbid_arguments={} direct_eval={} ts_namespace={}{order_note}\n",
                <&'static str>::from(scope.kind),
                scope.strict_mode as u8,
                scope.generated.len(),
                scope.forbid_arguments,
                scope.contains_direct_eval,
                scope.ts_namespace.is_some(),
            ));
            for (name, member) in scope.members.iter() {
                let symbol = parsed.symbols.get(member.ref_.inner_index() as usize);
                out.push_str(&format!(
                    "    member {} -> {}#{} kind={} loc={}\n",
                    bstr::BStr::new(name),
                    tag(member.ref_),
                    member.ref_.inner_index(),
                    symbol.map_or("?", |s| <&'static str>::from(s.kind)),
                    member.loc.start
                ));
            }
            if scope.label_ref.is_valid() {
                out.push_str(&format!("    label_ref {}#{}\n", tag(scope.label_ref), scope.label_ref.inner_index()));
            }
        }
        for (index, symbol) in parsed.symbols.iter().enumerate() {
            let link = symbol.link.get();
            out.push_str(&format!(
                "symbol#{index} {} {} link={}\n",
                <&'static str>::from(symbol.kind),
                bstr::BStr::new(symbol.original_name.slice()),
                if link.is_valid() { format!("#{}", link.inner_index()) } else { "-".to_owned() }
            ));
        }
        for erased in &parsed.sidecar.erased.statements {
            let kind = match erased.data {
                bun_js_parser::parse::erased::ErasedData::Interface(_) => "Interface",
                bun_js_parser::parse::erased::ErasedData::TypeAlias(_) => "TypeAlias",
                bun_js_parser::parse::erased::ErasedData::Declaration(_) => "Declaration",
                bun_js_parser::parse::erased::ErasedData::Module(_) => "Module",
                bun_js_parser::parse::erased::ErasedData::NamespaceExport(_) => "NamespaceExport",
                bun_js_parser::parse::erased::ErasedData::Import(_) => "Import",
                bun_js_parser::parse::erased::ErasedData::ImportEquals(_) => "ImportEquals",
                bun_js_parser::parse::erased::ErasedData::Export(_) => "Export",
            };
            out.push_str(&format!("erased {kind} [{},{}) place={:?} flags={:?}\n", erased.start, erased.end, erased.place, erased.flags));
        }
        if tree {
            let mut dump = Dump { parsed, out: String::new(), depth: 0 };
            for stmt in parsed.stmts {
                dump.visit_stmt(stmt);
            }
            for erased in &parsed.sidecar.erased.statements {
                if let bun_js_parser::parse::erased::ErasedData::Declaration(stmt) = &erased.data {
                    dump.line(format!("ERASED-DECLARATION [{},{})", erased.start, erased.end));
                    dump.depth += 1;
                    // SAFETY: not needed, the statement is a plain reference into the arena.
                    let stmt: &Stmt = unsafe { &*core::ptr::from_ref(stmt) };
                    dump.visit_stmt(stmt);
                    dump.depth -= 1;
                }
                if let bun_js_parser::parse::erased::ErasedData::Module(module) = &erased.data {
                    dump.line(format!("ERASED-MODULE [{},{}) keyword={:?}", erased.start, erased.end, module.keyword));
                    if let Some(body) = &module.body {
                        dump.depth += 1;
                        for stmt in body.slice() {
                            // SAFETY: as above.
                            let stmt: &Stmt = unsafe { &*core::ptr::from_ref(stmt) };
                            dump.visit_stmt(stmt);
                        }
                        dump.depth -= 1;
                    }
                }
            }
            out.push_str(&dump.out);
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
    let mut tree = true;
    for path in std::env::args().skip(1) {
        if path == "--no-tree" {
            tree = false;
            continue;
        }
        println!("== {path}");
        if let Ok(text) = std::fs::read_to_string(&path) {
            for line in text.lines() {
                println!("   | {line}");
            }
        }
        match dump(&path, tree) {
            Some(out) => print!("{out}"),
            None => println!("CANNOT_READ_OR_INIT"),
        }
    }
}

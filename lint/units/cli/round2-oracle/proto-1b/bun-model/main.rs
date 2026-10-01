// SCRATCH MODEL of research pass 1b, not part of the change. It runs `Parser::parse_for_lint` of the debug build of the worktree
// (rustc against its rlibs: `python3 build.py`, 3 s, no crate is rebuilt) and prints, per file:
//   default: the wrapper records, type arguments, return types, erased statements and members, symbols, and whether the
//            operand of every record is a node of the tree (`IN-TREE`);
//   MINI=1:  the reports of eight rules written against the side table (`R <rule> <byte offset> <text>`):
//            no-compare-neg-zero, valid-typeof (literals), no-unsafe-negation, no-dupe-class-members (names that are plain
//            strings), no-debugger, no-empty-pattern, no-sparse-arrays, use-isnan. `node mini-compare.cjs` compares them
//            with ESLint over the fixtures of the tree and the lists of ../cases.
// Result at be1ebe5295 over 4008 cases (the 3341 of the fixtures and the TypeScript lists): 1437 (case, rule) pairs with a
// report, 1336 equal to ESLint. The 101 others: 45 names that this model does not compute (BigInt, null, regular expression,
// UTF-16, a number that is no integer); 11 nodes inside a type; 1 `undefined` spelled with an escape that the comparison
// does not filter; use-isnan 44: 39 where a name is declared in another scope (19 of them JavaScript cases that the fixture
// has as `missing`), 3 `case` behind a comment or a line break, 2 extra for a default or namespace import from "bun:bundle".
// 661 records over 896 TypeScript files: every operand is a node of the tree.
#![allow(warnings, clippy::all, unreachable_pub)]
#[path = "/workspace/wt/cli/src/js_parser/native_test_shims.rs"]
mod native_test_shims;
#[allow(non_snake_case)]
mod Macro {
    pub use bun_js_parser::Macro::MacroRemapEntry;
}

use std::collections::HashSet;
use std::fmt::Write as _;

use bun_ast::walk::{self, Visitor};
use bun_ast::{Expr, ExprData, Loc, Stmt, StmtData, S, G, B};
use bun_js_parser::parse::erased::{ErasedData, ErasedMemberData, ModuleName};
use bun_js_parser::parse::generics::TypeArgumentsOf;
use bun_js_parser::parse::parse_entry::ParsedForLint;
use bun_js_parser::parse::wrappers::ExprId;

struct Ids {
    ids: HashSet<ExprId>,
    lines: Vec<String>,
    depth: usize,
}

impl<'ast> Visitor<'ast> for Ids {
    fn enter_expr(&mut self, expr: &'ast Expr) {
        self.ids.insert(ExprId::of(expr));
    }
    fn visit_expr(&mut self, expr: &'ast Expr) {
        // The left spine of a binary is walked without a call per link: each link is entered here all the same.
        let mut e = expr;
        while let ExprData::EBinary(b) = &e.data {
            self.ids.insert(ExprId::of(e));
            e = &b.left;
        }
        walk::walk_expr(self, expr);
    }
    fn visit_s_class(&mut self, node: &'ast S::Class, loc: Loc) {
        self.class(&node.class, loc);
        walk::walk_s_class(self, node);
    }
    fn visit_e_class(&mut self, node: &'ast bun_ast::E::Class, loc: Loc) {
        self.class(node, loc);
        walk::walk_e_class(self, node);
    }
    fn visit_s_switch(&mut self, node: &'ast S::Switch, loc: Loc) {
        let cases: Vec<String> = node.cases.slice().iter().map(|c| format!("case.loc={} value@{:?}", c.loc.start, c.value.map(|v| v.loc.start))).collect();
        self.lines.push(format!("{}[switch body_loc={} {}]", "  ".repeat(self.depth), node.body_loc.start, cases.join("; ")));
        walk::walk_s_switch(self, node);
    }
    fn visit_stmt(&mut self, stmt: &'ast Stmt) {
        let tag: &'static str = stmt.data.tag().into();
        self.lines.push(format!("{}{}@{}", "  ".repeat(self.depth), tag, stmt.loc.start));
        self.depth += 1;
        walk::walk_stmt(self, stmt);
        self.depth -= 1;
    }
}

impl Ids {
    fn class(&mut self, class: &G::Class, loc: Loc) {
        let props: Vec<String> = class.properties.slice().iter().map(|p| {
            let key = p.key.map(|k| { let t: &'static str = k.data.tag().into(); format!("{t}@{}", k.loc.start) });
            format!("kind={} key={key:?} static={} computed={} method={} value={} init={} decorators={}", p.kind as u8, p.flags.contains(bun_ast::flags::Property::IsStatic), p.flags.contains(bun_ast::flags::Property::IsComputed), p.flags.contains(bun_ast::flags::Property::IsMethod), p.value.is_some(), p.initializer.is_some(), p.ts_decorators.len())
        }).collect();
        let decorators: Vec<i32> = class.ts_decorators.iter().map(|d| d.loc.start).collect();
        self.lines.push(format!("{}[class loc={} keyword={} body_loc={} decorators@{decorators:?} props: {}]", "  ".repeat(self.depth), loc.start, class.class_keyword.loc.start, class.body_loc.start, props.join(" ; ")));
    }
}

fn describe(text: &[u8], parsed: &ParsedForLint<'_, '_>) -> String {
    let mut out = String::new();
    let src = |a: u32, b: u32| String::from_utf8_lossy(text.get(a as usize..b as usize).unwrap_or(b"?")).into_owned();
    let mut ids = Ids { ids: HashSet::new(), lines: Vec::new(), depth: 0 };
    for stmt in parsed.stmts {
        ids.visit_stmt(stmt);
    }
    let tree_ids = ids.ids.len();
    let _ = writeln!(out, " stmts: {}", ids.lines.join(" | "));
    // what the erased records hold is walked too: their nodes are where a record can point
    let mut erased_lines = Vec::new();
    for record in &parsed.sidecar.erased.statements {
        let kind = match &record.data {
            ErasedData::Interface(n) => format!("interface {}", String::from_utf8_lossy(n.text.slice())),
            ErasedData::TypeAlias(n) => format!("type-alias {}", String::from_utf8_lossy(n.text.slice())),
            ErasedData::Declaration(stmt) => {
                let before = ids.lines.len();
                ids.depth = 0;
                ids.visit_stmt(stmt);
                let inner = ids.lines.split_off(before).join(" | ");
                let name = match &stmt.data {
                    StmtData::SEnum(e) => format!(" enum-name-ref-valid={} name_of={:?}", e.name.ref_.is_valid(), String::from_utf8_lossy(parsed.name_of(e.name.ref_))),
                    StmtData::SClass(c) => format!(" class-name={:?}", c.class.class_name.map(|n| String::from_utf8_lossy(parsed.name_of(n.ref_)).into_owned())),
                    StmtData::SFunction(f) => format!(" fn-name={:?}", f.func.name.map(|n| String::from_utf8_lossy(parsed.name_of(n.ref_)).into_owned())),
                    _ => String::new(),
                };
                format!("declaration {{{inner}}}{name}")
            }
            ErasedData::Module(decl) => {
                let name = match &decl.name {
                    ModuleName::Identifier(n) => String::from_utf8_lossy(n.text.slice()).into_owned(),
                    ModuleName::String(s) => format!("{:?}", String::from_utf8_lossy(s.value.slice())),
                };
                let before = ids.lines.len();
                let mut n = 0;
                if let Some(body) = decl.body {
                    for stmt in body.slice() {
                        ids.depth = 0;
                        ids.visit_stmt(stmt);
                        n += 1;
                    }
                }
                let inner = ids.lines.split_off(before).join(" | ");
                format!("module {:?} {name} body[{n}]={{{inner}}}", decl.keyword)
            }
            ErasedData::NamespaceExport(n) => format!("namespace-export {}", String::from_utf8_lossy(n.text.slice())),
            ErasedData::Import(_) => "import".to_owned(),
            ErasedData::ImportEquals(d) => format!("import-equals {}", String::from_utf8_lossy(d.name.text.slice())),
            ErasedData::Export(_) => "export".to_owned(),
        };
        erased_lines.push(format!("  erased [{},{}) {:?} {:?} {kind}", record.start, record.end, record.place, record.flags));
    }
    for member in &parsed.sidecar.erased.members {
        let what = match &member.data {
            ErasedMemberData::Property(p) => {
                if let Some(key) = &p.key { ids.visit_expr(key); }
                if let Some(v) = &p.value { ids.visit_expr(v); }
                if let Some(v) = &p.initializer { ids.visit_expr(v); }
                let key = p.key.map(|k| { let t: &'static str = k.data.tag().into(); format!("{t}@{}", k.loc.start) });
                format!("property kind={} key={key:?} static={} value={}", p.kind as u8, p.flags.contains(bun_ast::flags::Property::IsStatic), p.value.is_some())
            }
            ErasedMemberData::IndexSignature => "index-signature".to_owned(),
        };
        erased_lines.push(format!("  member [{},{}) class_body@{} #{} {:?} {what}", member.start, member.end, member.class_body, member.index, member.flags));
    }
    let _ = writeln!(out, " ids: tree {tree_ids}, with erased {}", ids.ids.len());
    for record in &parsed.sidecar.wrappers.records {
        let tag: &'static str = record.operand.data.tag().into();
        let found = ids.ids.contains(&ExprId::of(&record.operand));
        let _ = writeln!(out, "  wrapper {} [{},{}) {:?} of {tag}@{} {}", record.data.kind_name(), record.op, record.end, src(record.op, record.end), record.operand.loc.start, if found { "IN-TREE" } else { "NOT-IN-TREE" });
    }
    for record in &parsed.sidecar.generics.type_arguments {
        let tag: &'static str = record.operand.data.tag().into();
        let found = ids.ids.contains(&ExprId::of(&record.operand));
        let of = match record.of { TypeArgumentsOf::Expression => "expression", TypeArgumentsOf::OptionalCall => "optional-call" };
        let _ = writeln!(out, "  type-arguments {} [{},{}) after {tag}@{} {of} next={:?} {}", src(record.lt, record.end), record.lt, record.end, record.operand.loc.start, src(record.end, (record.end + 3).min(text.len() as u32)), if found { "IN-TREE" } else { "NOT-IN-TREE" });
    }
    for record in &parsed.sidecar.attached.return_types {
        let _ = writeln!(out, "  return-type {:?} type[{},{}) {:?}", record.owner, record.type_node.start, record.type_node.end, src(record.type_node.start, record.type_node.end));
    }
    for record in &parsed.sidecar.attached.specifiers {
        let _ = writeln!(out, "  type-only-specifier stmt@{} #{} [{},{}) {:?}", record.statement, record.index, record.specifier.start, record.specifier.end, src(record.specifier.start, record.specifier.end));
    }
    for line in erased_lines {
        let _ = writeln!(out, "{line}");
    }
    let _ = writeln!(out, "  attached: annotations {} this {} type_parameters {} return_types {} heritage {} jsx {} keywords {} specifiers {}", parsed.sidecar.attached.annotations.len(), parsed.sidecar.attached.this_parameters.len(), parsed.sidecar.attached.type_parameters.len(), parsed.sidecar.attached.return_types.len(), parsed.sidecar.attached.heritage.len(), parsed.sidecar.attached.jsx_type_arguments.len(), parsed.sidecar.attached.keywords.len(), parsed.sidecar.attached.specifiers.len());
    let names: Vec<String> = parsed.symbols.iter().map(|s| String::from_utf8_lossy(s.original_name.slice()).into_owned()).collect();
    let _ = writeln!(out, "  symbols: {}", names.join(","));
    out
}


// ---- a scratch model of the helpers that the rules would read from the side table ----
use bun_ast::{E, OpCode};
use bun_js_parser::parse::wrappers::{Wrapper, WrapperData};

struct Mini<'p, 'a> {
    parsed: &'p ParsedForLint<'p, 'a>,
    text: &'a [u8],
    by_id: std::collections::HashMap<ExprId, Vec<usize>>,
    instantiated: HashSet<ExprId>,
    out: Vec<String>,
    targets: Vec<usize>,
    declared: u8,
    held: Vec<(String, u8)>,
}

fn leftmost_child(expr: &Expr) -> Option<&Expr> {
    match &expr.data {
        ExprData::EBinary(b) => Some(&b.left),
        ExprData::EDot(d) => Some(&d.target),
        ExprData::EIndex(i) => Some(&i.target),
        ExprData::ECall(c) => Some(&c.target),
        ExprData::EIf(c) => Some(&c.test),
        ExprData::ETemplate(t) => t.tag.as_ref(),
        ExprData::EUnary(u) if matches!(u.op, OpCode::UnPostDec | OpCode::UnPostInc) => Some(&u.value),
        _ => None,
    }
}

impl<'p, 'a> Mini<'p, 'a> {
    fn new(parsed: &'p ParsedForLint<'p, 'a>, text: &'a [u8]) -> Self {
        let mut by_id: std::collections::HashMap<ExprId, Vec<usize>> = Default::default();
        for (i, r) in parsed.sidecar.wrappers.records.iter().enumerate() {
            by_id.entry(ExprId::of(&r.operand)).or_default().push(i);
        }
        let mut instantiated = HashSet::new();
        for r in &parsed.sidecar.generics.type_arguments {
            if r.of != TypeArgumentsOf::Expression { continue; }
            // what follows the `>`: a `(` or a template makes them the type arguments of a call or of a tag
            let mut at = r.end as usize;
            while matches!(text.get(at), Some(b' ' | b'\t' | b'\n' | b'\r')) { at += 1; }
            if !matches!(text.get(at), Some(b'(' | b'`')) { instantiated.insert(ExprId::of(&r.operand)); }
        }
        Mini { parsed, text, by_id, instantiated, out: Vec::new(), targets: Vec::new(), declared: 0, held: Vec::new() }
    }
    fn wrappers_of(&self, expr: &Expr) -> Vec<&'p Wrapper> {
        self.by_id.get(&ExprId::of(expr)).map(|v| v.iter().map(|&i| &self.parsed.sidecar.wrappers.records[i]).collect()).unwrap_or_default()
    }
    fn is_ts_wrapped(&self, expr: &Expr) -> bool {
        self.wrappers_of(expr).iter().any(|w| !matches!(w.data, WrapperData::Parenthesized)) || self.instantiated.contains(&ExprId::of(expr))
    }
    /// where the text of `expr` starts with its parentheses and a type assertion before it
    fn full_start(&self, mut expr: &Expr) -> i32 {
        loop {
            if let Some(op) = self.wrappers_of(expr).iter().rev().find_map(|w| match w.data { WrapperData::Parenthesized | WrapperData::TypeAssertion(_) => Some(w.op), _ => None }) {
                return op as i32;
            }
            match leftmost_child(expr) {
                Some(child) => expr = child,
                None => {
                    if let ExprData::EClass(class) = &expr.data {
                        if let Some(first) = class.ts_decorators.iter().next() {
                            let mut at = self.full_start(first) as usize;
                            while at > 0 && matches!(self.text.get(at - 1), Some(b' ' | b'\t' | b'\n' | b'\r')) { at -= 1; }
                            if at > 0 && self.text.get(at - 1) == Some(&b'@') { return (at - 1) as i32; }
                        }
                    }
                    return expr.loc.start;
                }
            }
        }
    }
    fn is_neg_zero(&self, node: &Expr) -> bool {
        if self.is_ts_wrapped(node) { return false; }
        let ExprData::EUnary(unary) = &node.data else { return false; };
        unary.op == OpCode::UnNeg && !self.is_ts_wrapped(&unary.value) && matches!(&unary.value.data, ExprData::ENumber(n) if n.value() == 0.0)
    }
    fn is_typeof(&self, node: &Expr) -> bool {
        !self.is_ts_wrapped(node) && matches!(&node.data, ExprData::EUnary(u) if u.op == OpCode::UnTypeof)
    }
    fn sibling(&mut self, sibling: &Expr) {
        if self.is_ts_wrapped(sibling) { return; }
        let bad = match &sibling.data {
            ExprData::EString(s) => !s.is_utf8() || !matches!(s.slice8(), b"symbol" | b"undefined" | b"object" | b"boolean" | b"number" | b"string" | b"function" | b"bigint"),
            ExprData::ENumber(_) | ExprData::EBigInt(_) | ExprData::EBoolean(_) | ExprData::ENull(_) | ExprData::ERegExp(_) => true,
            ExprData::EIdentifier(_) => false,
            _ => false,
        };
        if bad { self.out.push(format!("R valid-typeof {} Invalid typeof comparison value.", sibling.loc.start)); }
    }
}


impl<'p, 'a> Mini<'p, 'a> {
    fn key_name(&self, p: &G::Property) -> Option<Vec<u8>> {
        let key = p.key.as_ref()?;
        if p.flags.contains(bun_ast::flags::Property::IsComputed) && self.is_ts_wrapped(key) { return None; }
        match &key.data {
            ExprData::EString(s) if s.next.is_none() && s.is_utf8() => Some(s.slice8().to_vec()),
            ExprData::ENumber(n) if n.value().fract() == 0.0 && n.value().abs() < 1e15 => Some(format!("{}", n.value() as i64).into_bytes()),
            _ => None,
        }
    }
    fn class_members(&mut self, class: &G::Class) {
        use bun_js_parser::parse::erased::ErasedFlags;
        let body = class.body_loc.start as u32;
        let erased: Vec<(u32, &G::Property)> = self.parsed.sidecar.erased.members.iter().filter_map(|m| match &m.data {
            ErasedMemberData::Property(p) if m.class_body == body && m.flags.contains(ErasedFlags::DECLARE) && !m.flags.contains(ErasedFlags::ABSTRACT) && !m.flags.contains(ErasedFlags::NO_BODY) => Some((m.index, &**p)),
            _ => None,
        }).collect();
        let props = class.properties.slice();
        let mut ordered: Vec<&G::Property> = Vec::new();
        let mut next = 0;
        for (i, p) in props.iter().enumerate() {
            while next < erased.len() && erased[next].0 as usize <= i { ordered.push(erased[next].1); next += 1; }
            ordered.push(p);
        }
        while next < erased.len() { ordered.push(erased[next].1); next += 1; }
        // name and static -> (init, get, set)
        let mut state: std::collections::HashMap<(Vec<u8>, bool), u8> = Default::default();
        for p in ordered {
            let kind = p.kind as u8;
            // 0 normal, 1 get, 2 set, 4 declare
            let (clashes, defines) = match kind { 0 | 4 => (7u8, 1u8), 1 => (3, 2), 2 => (5, 4), _ => continue };
            let Some(name) = self.key_name(p) else { continue };
            let is_static = p.flags.contains(bun_ast::flags::Property::IsStatic);
            if !is_static && !p.flags.contains(bun_ast::flags::Property::IsComputed) && name == b"constructor" { continue; }
            let entry = state.entry((name.clone(), is_static)).or_insert(0);
            if *entry & clashes != 0 {
                self.out.push(format!("R no-dupe-class-members {} Duplicate name '{}'.", p.key.map_or(0, |k| k.loc.start), String::from_utf8_lossy(&name)));
            }
            *entry |= defines;
        }
    }
}



const NAN: u8 = 1;
const NUMBER: u8 = 2;
fn global(name: &[u8]) -> u8 {
    match name { b"NaN" => NAN, b"Number" => NUMBER, _ => 0 }
}
/// whether `name` stands in `text` as a word of its own
fn has_word(text: &[u8], name: &[u8]) -> bool {
    let is_part = |b: u8| b.is_ascii_alphanumeric() || b == b'_' || b == b'$' || b >= 0x80;
    text.windows(name.len()).enumerate().any(|(i, w)| w == name && (i == 0 || !is_part(text[i - 1])) && text.get(i + name.len()).is_none_or(|b| !is_part(*b)))
}

impl<'p, 'a> Mini<'p, 'a> {
    fn declare(&mut self, name: &[u8]) { self.declared |= global(name); }
    fn declare_words(&mut self, text: &[u8]) {
        for name in [&b"NaN"[..], b"Number"] { if has_word(text, name) { self.declare(name); } }
    }
    fn nan(&self, expr: &Expr) -> u8 {
        if self.is_ts_wrapped(expr) { return 0; }
        let expr = match &expr.data { ExprData::EBinary(b) if b.op == OpCode::BinComma => &b.right, _ => expr };
        if self.is_ts_wrapped(expr) { return 0; }
        let (target, name): (&Expr, Option<&[u8]>) = match &expr.data {
            ExprData::EIdentifier(id) => return if self.parsed.name_of(id.ref_) == b"NaN" { NAN } else { 0 },
            ExprData::EDot(dot) => (&dot.target, Some(dot.name.slice())),
            ExprData::EIndex(index) => (&index.target, match &index.index.data {
                ExprData::EString(s) if !self.is_ts_wrapped(&index.index) && s.next.is_none() && s.is_utf8() => Some(s.slice8()),
                _ => None,
            }),
            _ => return 0,
        };
        if self.is_ts_wrapped(target) { return 0; }
        let ExprData::EIdentifier(object) = &target.data else { return 0; };
        if self.parsed.name_of(object.ref_) == b"Number" && name == Some(b"NaN") { NUMBER } else { 0 }
    }
    /// the `case` before the test, with blanks and `(` between them only; else the first token of the test
    fn case_start(&self, value: &Expr) -> i32 {
        let mut at = self.full_start(value) as usize;
        loop {
            while at > 0 && matches!(self.text.get(at - 1), Some(b' ' | b'\t')) { at -= 1; }
            if at > 0 && self.text.get(at - 1) == Some(&b'(') { at -= 1; } else { break; }
        }
        if at >= 4 && self.text.get(at - 4..at) == Some(b"case") { (at - 4) as i32 } else { value.loc.start }
    }
    fn finish(&mut self) {
        // the names that the parse pass declared, a macro import among them
        for symbol in self.parsed.symbols { let name = symbol.original_name.slice().to_vec(); self.declare(&name); }
        for record in &self.parsed.sidecar.erased.statements {
            match &record.data {
                ErasedData::Module(decl) => if let ModuleName::Identifier(name) = &decl.name {
                    let mut after = name.end as usize;
                    while matches!(self.text.get(after), Some(b' ' | b'\t' | b'\n' | b'\r')) { after += 1; }
                    let dotted = self.text.get(after) == Some(&b'.') || record.flags.contains(bun_js_parser::parse::erased::ErasedFlags::NESTED);
                    if !dotted { let n = name.text.slice().to_vec(); self.declare(&n); }
                },
                ErasedData::ImportEquals(decl) => { let n = decl.name.text.slice().to_vec(); self.declare(&n); }
                ErasedData::Import(_) => { let t = self.text.get(record.start as usize..record.end as usize).unwrap_or(b"").to_vec(); self.declare_words(&t); }
                _ => {}
            }
        }
        let declared = self.declared;
        for (line, names) in core::mem::take(&mut self.held) {
            if names & !declared != 0 { self.out.push(line); }
        }
    }
}

fn target_of(expr: &Expr) -> Option<usize> {
    match &expr.data {
        ExprData::EArray(array) => Some(core::ptr::from_ref::<E::Array>(array).addr()),
        ExprData::EObject(object) => Some(core::ptr::from_ref::<E::Object>(object).addr()),
        ExprData::EBinary(binary) if binary.op == OpCode::BinAssign => Some(core::ptr::from_ref::<E::Binary>(binary).addr()),
        ExprData::ESpread(spread) => match &spread.value.data {
            ExprData::EArray(_) | ExprData::EObject(_) => target_of(&spread.value),
            _ => None,
        },
        _ => None,
    }
}

impl<'p, 'a> Mini<'p, 'a> {
    /// `expr` is written where a target is expected: with anything around it, it is an expression and no pattern.
    fn mark(&mut self, expr: &Expr) {
        let target = match &expr.data { ExprData::ESpread(s) => &s.value, _ => expr };
        if !self.wrappers_of(target).is_empty() { return; }
        if let Some(address) = target_of(expr) { self.targets.push(address); }
    }
    fn take(&mut self, address: usize) -> bool {
        if self.targets.last() == Some(&address) { self.targets.pop(); return true; }
        false
    }
}

impl<'ast, 'p, 'a> Visitor<'ast> for Mini<'p, 'a> {

    fn visit_b_identifier(&mut self, node: &'ast B::Identifier, _: Loc) {
        let name = self.parsed.name_of(node.r#ref).to_vec();
        self.declare(&name);
    }
    fn visit_s_function(&mut self, node: &'ast S::Function, _: Loc) {
        if let Some(name) = &node.func.name { let n = self.parsed.name_of(name.ref_).to_vec(); self.declare(&n); }
        walk::walk_s_function(self, node);
    }
    fn visit_e_function(&mut self, node: &'ast E::Function, _: Loc) {
        if let Some(name) = &node.func.name { let n = self.parsed.name_of(name.ref_).to_vec(); self.declare(&n); }
        walk::walk_e_function(self, node);
    }
    fn visit_s_enum(&mut self, node: &'ast S::Enum, _: Loc) {
        let n = self.parsed.name_of(node.name.ref_).to_vec(); self.declare(&n);
        for value in node.values.slice() { let n = value.name.slice().to_vec(); self.declare(&n); }
        walk::walk_s_enum(self, node);
    }
    fn visit_s_namespace(&mut self, node: &'ast S::Namespace, _: Loc) {
        let n = self.parsed.name_of(node.name.ref_).to_vec(); self.declare(&n);
        walk::walk_s_namespace(self, node);
    }
    fn visit_s_import(&mut self, _node: &'ast S::Import, loc: Loc) {
        // the names with `type` leave no item: the words of the clause, up to the string of the module
        let from = loc.start as usize;
        let mut at = from;
        let mut depth = 0;
        while let Some(&b) = self.text.get(at) {
            match b { b'{' => depth += 1, b'}' => depth -= 1, b'"' | b'\'' if depth == 0 => break, b';' => break, _ => {} }
            at += 1;
        }
        let t = self.text.get(from..at).unwrap_or(b"").to_vec();
        self.declare_words(&t);
    }
    fn visit_s_switch(&mut self, node: &'ast S::Switch, loc: Loc) {
        let names = self.nan(&node.test);
        if names != 0 { self.held.push((format!("R use-isnan {} 'switch(NaN)' can never match a case clause. Use Number.isNaN instead of the switch.", loc.start), names)); }
        for case in node.cases.slice() {
            let Some(value) = &case.value else { continue };
            let names = self.nan(value);
            if names != 0 { let start = self.case_start(value); self.held.push((format!("R use-isnan {start} 'case NaN' can never match. Use Number.isNaN before the switch."), names)); }
        }
        walk::walk_s_switch(self, node);
    }
    fn visit_s_debugger(&mut self, _: &'ast S::Debugger, loc: Loc) {
        self.out.push(format!("R no-debugger {} Unexpected 'debugger' statement.", loc.start));
    }
    fn visit_s_for_in(&mut self, node: &'ast S::ForIn, _: Loc) {
        if let StmtData::SExpr(head) = &node.init.data { self.mark(&head.value); }
        walk::walk_s_for_in(self, node);
    }
    fn visit_s_for_of(&mut self, node: &'ast S::ForOf, _: Loc) {
        if let StmtData::SExpr(head) = &node.init.data { self.mark(&head.value); }
        walk::walk_s_for_of(self, node);
    }
    fn visit_b_array(&mut self, node: &'ast B::Array, loc: Loc) {
        if node.items.slice().is_empty() { self.out.push(format!("R no-empty-pattern {} Unexpected empty array pattern.", loc.start)); }
        walk::walk_b_array(self, node);
    }
    fn visit_b_object(&mut self, node: &'ast B::Object, loc: Loc) {
        if node.properties.slice().is_empty() { self.out.push(format!("R no-empty-pattern {} Unexpected empty object pattern.", loc.start)); }
        walk::walk_b_object(self, node);
    }
    fn visit_e_array(&mut self, node: &'ast E::Array, loc: Loc) {
        if self.take(core::ptr::from_ref(node).addr()) {
            if node.items.as_slice().is_empty() { self.out.push(format!("R no-empty-pattern {} Unexpected empty array pattern.", loc.start)); }
            for item in node.items.as_slice().iter().rev() { self.mark(item); }
        } else {
            for item in node.items.as_slice() {
                if matches!(item.data, ExprData::EMissing(_)) { self.out.push(format!("R no-sparse-arrays {} Unexpected comma in middle of array.", item.loc.start)); }
            }
        }
        walk::walk_e_array(self, node);
    }
    fn visit_e_object(&mut self, node: &'ast E::Object, loc: Loc) {
        if self.take(core::ptr::from_ref(node).addr()) {
            if node.properties.as_slice().is_empty() { self.out.push(format!("R no-empty-pattern {} Unexpected empty object pattern.", loc.start)); }
            for property in node.properties.as_slice().iter().rev() {
                if let Some(value) = &property.value { self.mark(value); }
            }
        }
        walk::walk_e_object(self, node);
    }
    fn visit_s_class(&mut self, node: &'ast S::Class, _loc: Loc) {
        if let Some(name) = &node.class.class_name { let n = self.parsed.name_of(name.ref_).to_vec(); self.declare(&n); }
        self.class_members(&node.class);
        walk::walk_s_class(self, node);
    }
    fn visit_e_class(&mut self, node: &'ast E::Class, _loc: Loc) {
        if let Some(name) = &node.class_name { let n = self.parsed.name_of(name.ref_).to_vec(); self.declare(&n); }
        self.class_members(node);
        walk::walk_e_class(self, node);
    }
    fn visit_e_binary(&mut self, node: &'ast E::Binary, _loc: Loc) -> Option<&'ast Expr> {
        let _is_default = node.op == OpCode::BinAssign && self.take(core::ptr::from_ref(node).addr());
        if node.op == OpCode::BinAssign && matches!(node.left.data, ExprData::EArray(_) | ExprData::EObject(_)) { self.mark(&node.left); }
        let op = bun_ast::Op::TABLE.get_ptr_const(node.op).text;
        let is_equality = matches!(node.op, OpCode::BinLooseEq | OpCode::BinLooseNe | OpCode::BinStrictEq | OpCode::BinStrictNe);
        let is_comparison = is_equality || matches!(node.op, OpCode::BinLt | OpCode::BinLe | OpCode::BinGt | OpCode::BinGe);
        if is_comparison && (self.is_neg_zero(&node.left) || self.is_neg_zero(&node.right)) {
            let start = self.full_start(&node.left);
            self.out.push(format!("R no-compare-neg-zero {start} Do not use the '{}' operator to compare against -0.", String::from_utf8_lossy(op)));
        }
        if is_comparison {
            let names = self.nan(&node.left) | self.nan(&node.right);
            if names != 0 { let start = self.full_start(&node.left); self.held.push((format!("R use-isnan {start} Use the isNaN function to compare with NaN."), names)); }
        }
        if is_equality {
            if self.is_typeof(&node.left) { self.sibling(&node.right); }
            if self.is_typeof(&node.right) { self.sibling(&node.left); }
        }
        if matches!(node.op, OpCode::BinIn | OpCode::BinInstanceof) {
            if let ExprData::EUnary(u) = &node.left.data {
                if u.op == OpCode::UnNot && self.wrappers_of(&node.left).is_empty() {
                    self.out.push(format!("R no-unsafe-negation {} Unexpected negating the left operand of '{}' operator.", node.left.loc.start, String::from_utf8_lossy(op)));
                }
            }
        }
        walk::walk_e_binary(self, node)
    }
}

fn mini(text: &'static [u8], parsed: &ParsedForLint<'_, '_>) -> String {
    let mut m = Mini::new(parsed, text);
    for stmt in parsed.stmts { m.visit_stmt(stmt); }
    for record in &parsed.sidecar.erased.statements {
        match &record.data {
            ErasedData::Declaration(stmt) => m.visit_stmt(stmt),
            ErasedData::Module(decl) => if let Some(body) = decl.body { for stmt in body.slice() { m.visit_stmt(stmt); } },
            _ => {}
        }
    }
    for member in &parsed.sidecar.erased.members {
        if let ErasedMemberData::Property(p) = &member.data {
            for d in p.ts_decorators.iter() { m.visit_expr(d); }
            if let Some(e) = &p.key { m.visit_expr(e); }
            if let Some(e) = &p.value { m.visit_expr(e); }
            if let Some(e) = &p.initializer { m.visit_expr(e); }
        }
    }
    m.finish();
    m.out.join("\n") + "\n"
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    for name in args {
        let text: &'static [u8] = Box::leak(std::fs::read(&name).unwrap().into_boxed_slice());
        let path: &'static [u8] = Box::leak(name.clone().into_bytes().into_boxed_slice());
        let ext = name.rsplit('.').next().unwrap_or("");
        let loader = match ext {
            "ts" | "mts" | "cts" => bun_ast::Loader::Ts,
            "tsx" => bun_ast::Loader::Tsx,
            "jsx" => bun_ast::Loader::Jsx,
            _ => bun_ast::Loader::Js,
        };
        bun_ast::initialize_store();
        let _reset = bun_ast::StoreResetGuard::new();
        let arena = bun_alloc::Arena::new();
        let source = bun_ast::Source::init_path_string(path, text);
        let mut options = bun_js_parser::ParserOptions::init(Default::default(), loader);
        options.features.no_macros = true;
        options.features.is_macro_runtime = true;
        options.features.top_level_await = true;
        options.features.standard_decorators = true;
        let define = bun_js_parser::Define::default();
        let mut log = bun_ast::Log::init();
        log.level = bun_ast::Level::Warn;
        println!("== {name}: {}", String::from_utf8_lossy(text).replace('\n', "\\n"));
        match bun_js_parser::Parser::init(options, &mut log, &source, &define, &arena) {
            Err(err) => println!(" init Err({})", err.name()),
            Ok(parser) => match parser.parse_for_lint(|parsed| if std::env::var("MINI").is_ok() { mini(text, parsed) } else { describe(text, parsed) }) {
                Ok(out) => print!(" OK\n{out}"),
                Err(err) => {
                    let msgs: Vec<String> = log.msgs.iter().map(|m| String::from_utf8_lossy(m.data.text.as_ref()).into_owned()).collect();
                    println!(" Err({}) {}", err.name(), msgs.join(" ;; "));
                }
            },
        }
    }
}

// Two symbols of the crash reporter that this binary links to and never calls.
#[unsafe(no_mangle)]
extern "C" fn WTF__DumpStackTrace(_: *const core::ffi::c_void, _: usize) {}
#[unsafe(no_mangle)]
extern "C" fn posix_spawn_bun() -> i32 {
    -1
}

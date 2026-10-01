//! Research probe of "rules-regex" (top-down pass): the sites that the regex rules read of the tree of `Parser::parse_for_lint`,
//! one JSON line each: regex literals, calls and `new` whose target reaches the name `RegExp`, string literals and template
//! elements as no-useless-escape checks them. Not the final text: String, index syntax, println.
use bun_ast::walk::{self, Visitor};
use bun_ast::{E, Expr, ExprData, G, Loc, OpCode, S, Stmt};

use crate::dupe::Ctx;
use crate::eslint_utils;

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn hex16(units: &[u16]) -> String {
    units.iter().map(|u| format!("{u:04x}")).collect()
}

/// The UTF-16 code units of a string of the tree as written.
pub fn units_of(string: &E::EString) -> Vec<u16> {
    if string.is_utf8() { String::from_utf8_lossy(string.slice8()).encode_utf16().collect() } else { string.slice16().to_vec() }
}

fn is_assign(op: OpCode) -> bool {
    (op as u8) >= (OpCode::BinAssign as u8)
}

pub struct Rx<'c, 'p, 'a> {
    pub ctx: &'c Ctx<'p, 'a>,
    pub text: &'a [u8],
    pub out: Vec<String>,
    /// The strings that are the value of a JSX attribute written as a string, by the address of their payload.
    pub jsx_attr: Vec<usize>,
    /// An identifier named `RegExp` (1) or `globalThis` (2) is the target of an assignment somewhere.
    pub written: u8,
}

impl Rx<'_, '_, '_> {
    fn name(&self, expr: &Expr) -> Option<&[u8]> {
        match &expr.data {
            ExprData::EIdentifier(identifier) => Some(self.ctx.parsed.name_of(identifier.ref_)),
            _ => None,
        }
    }

    /// `expr` hands the value of the global `RegExp` on as ReferenceTracker follows it: `||`, `&&`, `??`, the branches of `?:`, the last of a comma, the right of an assignment. 1: the identifier `RegExp`. 2: the member `RegExp` of `globalThis`.
    fn reaches(&self, expr: &Expr, name: &[u8], member: bool, depth: u32) -> u8 {
        if depth > 64 {
            return 0;
        }
        match &expr.data {
            ExprData::EIdentifier(identifier) => u8::from(self.ctx.parsed.name_of(identifier.ref_) == name),
            ExprData::EDot(dot) if member => {
                if dot.name.slice() == name && self.reaches(&dot.target, b"globalThis", false, depth + 1) != 0 { 2 } else { 0 }
            }
            ExprData::EIndex(index) if member => {
                let key = eslint_utils::get_string_if_constant(self.ctx, &index.index);
                let want: Vec<u16> = name.iter().map(|&b| u16::from(b)).collect();
                if key.as_deref() == Some(&want[..]) && self.reaches(&index.target, b"globalThis", false, depth + 1) != 0 { 2 } else { 0 }
            }
            ExprData::EBinary(binary) => match binary.op {
                OpCode::BinLogicalOr | OpCode::BinLogicalAnd | OpCode::BinNullishCoalescing => {
                    self.reaches(&binary.left, name, member, depth + 1) | self.reaches(&binary.right, name, member, depth + 1)
                }
                OpCode::BinComma => self.reaches(&binary.right, name, member, depth + 1),
                op if is_assign(op) => self.reaches(&binary.right, name, member, depth + 1),
                _ => 0,
            },
            ExprData::EIf(conditional) => self.reaches(&conditional.yes, name, member, depth + 1) | self.reaches(&conditional.no, name, member, depth + 1),
            _ => 0,
        }
    }

    /// Whether a symbol of the parse pass has the name: the file declares it somewhere.
    fn declares(&self, name: &[u8]) -> bool {
        self.ctx.parsed.symbols.iter().any(|symbol| symbol.kind != bun_ast::SymbolKind::Unbound && symbol.original_name.slice() == name)
    }

    /// `expr` stands where a value is assigned to it.
    fn target(&mut self, expr: &Expr, depth: u32) {
        if depth > 64 {
            return;
        }
        match &expr.data {
            ExprData::EIdentifier(identifier) => match self.ctx.parsed.name_of(identifier.ref_) {
                b"RegExp" => self.written |= 1,
                b"globalThis" => self.written |= 2,
                _ => {}
            },
            ExprData::EArray(array) => {
                for item in array.items.as_slice() {
                    self.target(item, depth + 1);
                }
            }
            ExprData::EObject(object) => {
                for property in object.properties.iter() {
                    if let Some(value) = &property.value {
                        self.target(value, depth + 1);
                    }
                }
            }
            ExprData::ESpread(spread) => self.target(&spread.value, depth + 1),
            ExprData::EBinary(binary) if binary.op == OpCode::BinAssign => self.target(&binary.left, depth + 1),
            _ => {}
        }
    }

    fn call(&mut self, expr: &Expr, target: &Expr, args: &[Expr], is_new: bool) {
        let ident = self.name(target) == Some(b"RegExp");
        let tracked = self.reaches(target, b"RegExp", true, 0);
        if !ident && tracked == 0 {
            return;
        }
        let plain = self.ctx.plain_callee(target).is_some();
        let mut list = Vec::new();
        for arg in args {
            let kind = match &arg.data {
                ExprData::EString(string) if string.prefer_template => "tpl",
                ExprData::EString(_) => "str",
                ExprData::ERegExp(_) => "re",
                ExprData::ESpread(_) => "spread",
                _ => "x",
            };
            let value = eslint_utils::get_string_if_constant(self.ctx, arg);
            let undeclared = self.name(arg).is_some_and(|name| !self.declares(name));
            let units = match &arg.data {
                ExprData::EString(string) => format!("\"{}\"", hex16(&units_of(string))),
                _ => "null".into(),
            };
            list.push(format!(
                "{{\"t\":\"{kind}\",\"at\":{},\"loc\":{},\"ts\":{},\"un\":{undeclared},\"v\":{},\"u\":{units}}}",
                self.ctx.start_of_place(arg),
                arg.loc.start,
                self.ctx.plain(arg).is_none(),
                value.map_or("null".into(), |units| format!("\"{}\"", hex16(&units))),
            ));
        }
        self.out.push(format!(
            "{{\"k\":\"call\",\"at\":{},\"loc\":{},\"new\":{is_new},\"ident\":{ident},\"plain\":{plain},\"tracked\":{tracked},\"args\":[{}]}}",
            self.ctx.start_of_node(expr),
            expr.loc.start,
            list.join(",")
        ));
    }

    /// A string token that starts at `at`: a quote there is a string literal, a backtick a template without a substitution.
    fn string_at(&mut self, at: i32, what: &str) {
        match usize::try_from(at).ok().and_then(|at| self.text.get(at)) {
            Some(b'"' | b'\'') => self.out.push(format!("{{\"k\":\"str\",\"at\":{at},\"w\":\"{what}\"}}")),
            Some(b'`') => self.out.push(format!("{{\"k\":\"quasi\",\"at\":{at},\"w\":\"{what}\"}}")),
            _ => {}
        }
    }

    /// Whether a `{` stands between `from` and `to`, comments aside: the value of the attribute is an expression container.
    fn has_brace(&self, from: usize, to: usize) -> bool {
        let text = self.text;
        let mut i = from;
        while i < to && i < text.len() {
            match text[i] {
                b'{' => return true,
                b'/' if text.get(i + 1) == Some(&b'*') => {
                    i += 2;
                    while i + 1 < text.len() && !(text[i] == b'*' && text[i + 1] == b'/') {
                        i += 1;
                    }
                    i += 2;
                }
                b'/' if text.get(i + 1) == Some(&b'/') => {
                    while i < text.len() && text[i] != b'\n' && text[i] != b'\r' {
                        i += 1;
                    }
                }
                _ => i += 1,
            }
        }
        false
    }

    fn jsx(&mut self, element: &E::JSXElement) {
        for property in element.properties.iter() {
            if property.kind != G::PropertyKind::Normal {
                continue;
            }
            let (Some(key), Some(value)) = (&property.key, &property.value) else { continue };
            let ExprData::EString(string) = &value.data else { continue };
            let (Ok(from), Ok(to)) = (usize::try_from(key.loc.start), usize::try_from(value.loc.start)) else { continue };
            if !self.has_brace(from, to) {
                self.jsx_attr.push(core::ptr::from_ref::<E::EString>(string).addr());
            }
        }
    }
}

impl<'ast> Visitor<'ast> for Rx<'_, '_, '_> {
    fn enter_expr(&mut self, expr: &'ast Expr) {
        match &expr.data {
            ExprData::ERegExp(reg_exp) => {
                self.out.push(format!("{{\"k\":\"lit\",\"at\":{},\"raw\":\"{}\",\"ts\":{}}}", expr.loc.start, hex(reg_exp.value.slice()), self.ctx.plain(expr).is_none()));
            }
            ExprData::ECall(call) => self.call(expr, &call.target, call.args.as_slice(), false),
            ExprData::ENew(new) => self.call(expr, &new.target, new.args.as_slice(), true),
            ExprData::EString(string) => {
                let address = core::ptr::from_ref::<E::EString>(string).addr();
                if !self.jsx_attr.contains(&address) {
                    self.string_at(expr.loc.start, "expr");
                }
            }
            ExprData::ETemplate(template) => {
                if template.tag.is_none() {
                    self.out.push(format!("{{\"k\":\"quasi\",\"at\":{},\"w\":\"head\"}}", expr.loc.start));
                    for part in template.parts() {
                        self.out.push(format!("{{\"k\":\"quasi\",\"at\":{},\"w\":\"tail\"}}", part.tail_loc.start));
                    }
                }
            }
            ExprData::EJsxElement(element) => self.jsx(element),
            ExprData::EBinary(binary) if is_assign(binary.op) => self.target(&binary.left, 0),
            ExprData::EUnary(unary) if matches!(unary.op, OpCode::UnPreDec | OpCode::UnPreInc | OpCode::UnPostDec | OpCode::UnPostInc) => self.target(&unary.value, 0),
            _ => {}
        }
    }

    fn visit_s_for_in(&mut self, node: &'ast S::ForIn, _: Loc) {
        if let bun_ast::StmtData::SExpr(head) = &node.init.data {
            self.target(&head.value, 0);
        }
        walk::walk_s_for_in(self, node);
    }

    fn visit_s_for_of(&mut self, node: &'ast S::ForOf, _: Loc) {
        if let bun_ast::StmtData::SExpr(head) = &node.init.data {
            self.target(&head.value, 0);
        }
        walk::walk_s_for_of(self, node);
    }

    fn visit_s_directive(&mut self, _: &'ast S::Directive, loc: Loc) {
        self.string_at(loc.start, "directive");
    }

    fn visit_s_import(&mut self, node: &'ast S::Import, _: Loc) {
        if let Some(record) = self.ctx.parsed.import_records.get(node.import_record_index as usize) {
            self.string_at(record.range.loc.start, "import");
        }
    }

    fn visit_s_export_from(&mut self, node: &'ast S::ExportFrom, _: Loc) {
        if let Some(record) = self.ctx.parsed.import_records.get(node.import_record_index as usize) {
            self.string_at(record.range.loc.start, "import");
        }
    }

    fn visit_s_export_star(&mut self, node: &'ast S::ExportStar, _: Loc) {
        if let Some(record) = self.ctx.parsed.import_records.get(node.import_record_index as usize) {
            self.string_at(record.range.loc.start, "import");
        }
    }

    fn visit_s_enum(&mut self, node: &'ast S::Enum, _: Loc) {
        for value in node.values.slice() {
            self.string_at(value.loc.start, "enum");
        }
        walk::walk_s_enum(self, node);
    }
}

pub fn run(ctx: &Ctx<'_, '_>, text: &[u8], stmts: &[Stmt]) -> Vec<String> {
    use bun_js_parser::parse::erased::{ErasedData, ErasedMemberData, ModuleName};
    let mut rx = Rx { ctx, text, out: Vec::new(), jsx_attr: Vec::new(), written: 0 };
    for stmt in stmts {
        rx.visit_stmt(stmt);
    }
    let erased = &ctx.parsed.sidecar.erased;
    for record in &erased.statements {
        match &record.data {
            ErasedData::Declaration(stmt) => rx.visit_stmt(stmt),
            ErasedData::Module(module) => {
                if let ModuleName::String(name) = &module.name {
                    rx.string_at(name.start as i32, "module");
                }
                if let Some(body) = &module.body {
                    for stmt in body.slice() {
                        rx.visit_stmt(stmt);
                    }
                }
            }
            ErasedData::Import(import) => rx.string_at(import.module_specifier.start as i32, "import type"),
            ErasedData::Export(export) => {
                if let Some(specifier) = &export.module_specifier {
                    rx.string_at(specifier.start as i32, "export type");
                }
            }
            _ => {}
        }
    }
    for member in &erased.members {
        if let ErasedMemberData::Property(property) = &member.data {
            for decorator in property.ts_decorators.iter() {
                rx.visit_decorator(decorator);
            }
            for expr in [&property.key, &property.value, &property.initializer].into_iter().flatten() {
                rx.visit_expr(expr);
            }
        }
    }
    rx.out.push(format!("{{\"k\":\"seam\",\"RegExp\":{},\"globalThis\":{},\"written\":{}}}", ctx.is_global(b"RegExp"), ctx.is_global(b"globalThis"), rx.written));
    rx.out
}

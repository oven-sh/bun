use crate::atom::{Atom, Interner};
use crate::bind::{Bound, ClassOwner, Decl, Parent, PatParent, ScopeId, ScopeKind, SymFlags, SymbolId};
use crate::hir::{BinOp, Chain, ClassId, ExprId, ExprKind, File, FnBody, FnKind, IdList, PropKey, StmtId, StmtKind, VarKind};
use crate::util::FxHashSet;
use std::cell::RefCell;

pub const SCOPE_KEY: &[u8] = b"\0eval";

pub fn position_in_source(inserted: &[(u32, u32)], pos: u32) -> u32 {
    locate_in_source(inserted, pos).0
}

pub fn is_inserted(inserted: &[(u32, u32)], pos: u32) -> bool {
    locate_in_source(inserted, pos).1
}

fn locate_in_source(inserted: &[(u32, u32)], pos: u32) -> (u32, bool) {
    let mut ahead = 0;
    for &(at, len) in inserted {
        if pos < at + ahead {
            break;
        }
        if pos < at + ahead + len {
            return (at, true);
        }
        ahead += len;
    }
    (pos - ahead, false)
}

const RESERVED: [&[u8]; 47] = [
    b"arguments", b"await", b"break", b"case", b"catch", b"class", b"const", b"continue", b"debugger", b"default", b"delete", b"do", b"else", b"enum", b"eval", b"export", b"extends",
    b"false", b"finally", b"for", b"function", b"if", b"implements", b"import", b"in", b"instanceof", b"interface", b"let", b"new", b"null", b"package", b"private", b"protected",
    b"public", b"return", b"static", b"super", b"switch", b"this", b"throw", b"true", b"try", b"typeof", b"var", b"void", b"while", b"with",
];

fn is_name_of_variable(name: &[u8]) -> bool {
    let is_start = |c: u8| c.is_ascii_alphabetic() || c == b'_' || c == b'$' || c >= 0x80;
    name.first().is_some_and(|&c| is_start(c)) && name.iter().all(|&c| is_start(c) || c.is_ascii_digit()) && name != b"yield" && !RESERVED.contains(&name)
}

struct Rewriting<'a, 's> {
    hir: &'a File<'s>,
    bound: &'a Bound<'s>,
    atoms: &'a Interner<'s>,
    classes_reassigned_by_evals: RefCell<FxHashSet<ClassId>>,
    insertions: Vec<(u32, Vec<u8>)>,
}

struct ClassDeclaration {
    class: ClassId,
    start: u32,
    keyword: u32,
    end: u32,
}

pub fn attach_direct_eval_scopes<'s>(hir: &File<'s>, bound: &Bound<'s>, atoms: &Interner<'s>) -> Option<(Vec<u8>, Vec<(u32, u32)>)> {
    if hir.has_errors || hir.text.is_empty() {
        return None;
    }
    let mut it = Rewriting { hir, bound, atoms, classes_reassigned_by_evals: RefCell::default(), insertions: Vec::new() };
    it.add_direct_eval_scopes();
    it.add_reassigned_class_bindings();
    if it.insertions.is_empty() {
        return None;
    }
    it.insertions.sort_by_key(|insertion| insertion.0);
    let text: &[u8] = &hir.text;
    let mut rewritten = Vec::with_capacity(text.len() + it.insertions.iter().map(|insertion| insertion.1.len()).sum::<usize>());
    let mut copied = 0;
    for (at, inserted) in &it.insertions {
        let at = (*at as usize).min(text.len());
        rewritten.extend_from_slice(&text[copied..at]);
        rewritten.extend_from_slice(inserted);
        copied = at;
    }
    rewritten.extend_from_slice(&text[copied..]);
    let inserted = it.insertions.iter().map(|(at, inserted)| ((*at).min(text.len() as u32), inserted.len() as u32)).collect();
    Some((rewritten, inserted))
}

impl<'a, 's> Rewriting<'a, 's> {

    fn add_direct_eval_scopes(&mut self) {
        let (hir, bound) = (self.hir, self.bound);
        for (i, e) in hir.exprs.iter().enumerate() {
            let ExprKind::Call(call) = e.kind else { continue };
            let call = &hir[call];
            let ExprKind::Ident(callee) = hir[call.callee].kind else { continue };
            if call.chain != Chain::No || self.atoms.bytes(callee) != b"eval" || bound.expr_symbol[call.callee.idx()].is_some() {
                continue;
            }
            let Some(source) = hir.ids(call.args).next() else { continue };
            let Some(&scope) = bound.expr_scope.get(&ExprId(i as u32)) else { continue };
            if matches!(hir[source].kind, ExprKind::Spread(_) | ExprKind::Missing) {
                continue;
            }
            let object = self.object_for_scope(scope, hir[source].pos);
            self.insertions.push((hir[source].pos, object));
            self.insertions.push((hir[source].end, b")".to_vec()));
        }
    }

    fn is_free_name(&self, name: &[u8]) -> bool {
        let named = |(i, e): (usize, &crate::hir::Expr)| matches!(e.kind, ExprKind::Ident(it) if self.atoms.bytes(it) == name) && self.bound.expr_symbol[i].is_none();
        self.hir.exprs.iter().enumerate().any(named)
    }

    fn is_referenced_by_expression(&self, symbol: SymbolId) -> bool {
        self.hir.exprs.iter().enumerate().any(|(i, e)| matches!(e.kind, ExprKind::Ident(_)) && self.bound.expr_symbol[i] == symbol)
    }

    fn class_declaration(&self, symbol: SymbolId) -> Option<ClassDeclaration> {
        let (hir, bound) = (self.hir, self.bound);
        let of = &bound.symbols[symbol.idx()];
        let mut decls = of.decls.iter();
        let (Some(&Decl::Class(class)), None) = (decls.next(), decls.next()) else { return None };
        let ClassOwner::Stmt(stmt) = bound.class_owner[class.idx()] else { return None };
        if !hir.is_js || hir[class].name.is_none() {
            return None;
        }
        let (start, end) = (hir[stmt].start, hir[stmt].loc.end);
        let text: &[u8] = &hir.text;
        let written = text.get(start as usize..end as usize)?;
        let keyword = if written.starts_with(b"class") {
            0
        } else {
            let exported = written.strip_prefix(b"export")?;
            let blanks = exported.iter().take_while(|c| c.is_ascii_whitespace()).count();
            (blanks > 0 && exported[blanks..].starts_with(b"class")).then_some(b"export".len() + blanks)?
        };
        Some(ClassDeclaration { class, start, keyword: start + keyword as u32, end })
    }

    fn add_reassigned_class_bindings(&mut self) {
        let (hir, bound) = (self.hir, self.bound);
        let by_evals = self.classes_reassigned_by_evals.take();
        for stmt in hir.stmts.iter() {
            let StmtKind::Class(class) = stmt.kind else { continue };
            let symbol = bound.class_symbol[class.idx()];
            if symbol.is_none() {
                continue;
            }
            let Some(declaration) = self.class_declaration(symbol) else { continue };
            let is_stored_to = |&(_, target): &(SymbolId, ExprId)| {
                let never_stores = matches!(bound.expr_parent[target.idx()], Parent::Expr(parent) if parent.is_some()
                    && matches!(hir[parent].kind, ExprKind::Assign { op: Some(BinOp::Or | BinOp::Nullish), target: assigned, .. } if assigned == target));
                !never_stores && !(declaration.start <= hir[target].pos && hir[target].pos < declaration.end)
            };
            if by_evals.contains(&class) || bound.assignments_to(symbol).iter().any(is_stored_to) {
                self.insertions.push((declaration.keyword, [&b"let "[..], self.atoms.bytes(hir[class].name), b"="].concat()));
                self.insertions.push((declaration.end, b";".to_vec()));
            }
        }
    }

    fn is_assignable(&self, symbol: SymbolId, from: u32) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let of = &bound.symbols[symbol.idx()];
        if !of.flags.intersects(SymFlags::VARIABLE) {
            if !hir.is_js || of.flags.contains(SymFlags::ALIAS) {
                return false;
            }
            if !of.flags.contains(SymFlags::CLASS) {
                return of.flags.contains(SymFlags::FUNCTION);
            }
            let Some(declaration) = self.class_declaration(symbol).filter(|it| !(it.start <= from && from < it.end)) else { return false };
            self.classes_reassigned_by_evals.borrow_mut().insert(declaration.class);
            return true;
        }
        of.decls.iter().all(|decl| match *decl {
            Decl::Var(mut pat) | Decl::Require(mut pat) => {
                while let PatParent::Prop(outer, _) | PatParent::Elem(outer, _) = bound.pat_parent[pat.idx()] {
                    pat = outer;
                }
                !matches!(bound.pat_parent[pat.idx()], PatParent::Var(d) if !matches!(hir[d].kind, VarKind::Var | VarKind::Let))
            }
            _ => true,
        })
    }

    fn starts_with_use_strict(&self, body: IdList<StmtId>) -> bool {
        let hir = self.hir;
        for stmt in hir.ids(body) {
            let StmtKind::Expr(e) = hir[stmt].kind else { return false };
            let ExprKind::String(text) = hir[e].kind else { return false };
            let written = hir.text.get(hir[stmt].start as usize..).filter(|_| !hir.text.is_empty());
            if written.is_some_and(|written| !matches!(written.first(), Some(b'"' | b'\''))) {
                return false;
            }
            if self.atoms.bytes(text) == b"use strict" && written.is_none_or(|written| matches!(written.get(..12), Some(b"\"use strict\"" | b"'use strict'"))) {
                return true;
            }
        }
        false
    }

    fn is_in_field_initializer(&self, class: ClassId, pos: u32) -> bool {
        let hir = self.hir;
        hir[class].members.iter().any(|member| {
            let init = hir[member].init;
            init.is_some() && hir[init].pos <= pos && pos < hir[init].end
        })
    }

    fn object_for_scope(&self, innermost: ScopeId, pos: u32) -> Vec<u8> {
        let (hir, bound) = (self.hir, self.bound);
        let mut is_sloppy = bound.commonjs_indicator.is_some() && !self.starts_with_use_strict(hir.body);
        let mut names: Vec<(Atom, SymbolId)> = Vec::new();
        let mut seen: FxHashSet<Atom> = FxHashSet::default();
        let mut has_arguments = None;
        let mut new_target: Option<Option<&[u8]>> = None;
        let mut is_in_field = false;
        let mut has_super = false;
        let mut is_in_constructor = false;
        let mut may_lack_this = false;
        let mut private_names: Vec<u8> = Vec::new();
        let mut scope = innermost;
        while scope.is_some() {
            let at = &bound.scopes[scope.idx()];
            for &(name, symbol) in bound.table(at.locals) {
                let symbol = bound.export_symbol_of_value_symbol_if_exported(symbol);
                let flags = bound.symbols[symbol.idx()].flags;
                let is_value = flags.intersects(SymFlags::VALUE) || flags.contains(SymFlags::ALIAS) && (hir.is_js || self.is_referenced_by_expression(symbol));
                if is_value && seen.insert(name) && is_name_of_variable(self.atoms.bytes(name)) {
                    names.push((name, symbol));
                }
            }
            if let ScopeKind::Fn(func) = at.kind
                && has_arguments.is_none()
                && hir[func].kind != FnKind::Arrow
            {
                has_arguments = Some(matches!(hir[func].kind, FnKind::Decl | FnKind::Expr | FnKind::Method | FnKind::Getter | FnKind::Setter | FnKind::Constructor));
            }
            is_sloppy &= match at.kind {
                ScopeKind::Class(_) => false,
                ScopeKind::Fn(func) => !matches!(hir[func].body, FnBody::Block(body) if self.starts_with_use_strict(body)),
                _ => true,
            };
            if new_target.is_none() {
                match at.kind {
                    ScopeKind::Fn(func) => match hir[func].kind {
                        FnKind::Arrow => {}
                        FnKind::Decl | FnKind::Expr => new_target = Some(Some(b"new.target")),
                        FnKind::Constructor => {
                            new_target = Some(Some(b"new.target"));
                            has_super = true;
                            is_in_constructor = true;
                        }
                        FnKind::Method | FnKind::Getter | FnKind::Setter | FnKind::StaticBlock => {
                            new_target = Some(Some(b"void 0"));
                            has_super = true;
                        }
                        _ => new_target = Some(None),
                    },
                    ScopeKind::Class(class) if self.is_in_field_initializer(class, pos) => {
                        is_in_field = true;
                        has_super = true;
                        new_target = Some(Some(b"void 0"));
                    }
                    _ => {}
                }
            }
            if let ScopeKind::Class(class) = at.kind {
                may_lack_this |= std::mem::take(&mut is_in_constructor) && hir[class].extends.is_some();
                for member in hir[class].members.iter() {
                    if let PropKey::Private(name) = hir[member].key {
                        let name = self.atoms.bytes(name);
                        let name = name.strip_prefix(b"\xFE").unwrap_or(name);
                        private_names.extend_from_slice(bun_core::strings::split(name, b"@").next().unwrap_or(name));
                        private_names.push(b' ');
                    }
                }
            }
            if matches!(at.kind, ScopeKind::Class(_)) && has_arguments.is_none() {
                has_arguments = Some(false);
            }
            scope = at.parent;
        }
        let mut parameter = b"v".to_vec();
        while names.iter().any(|it| self.atoms.bytes(it.0) == &parameter[..]) {
            parameter.push(b'_');
        }
        let is_module_this = has_arguments.is_none() && bound.commonjs_indicator.is_none();
        let mut text = if is_module_this {
            b"(void{\"\\u0000eval\":void 0,__proto__:null".to_vec()
        } else if may_lack_this {
            b"(void{\"\\u0000eval\":(()=>{try{return this}catch{}})(),__proto__:null".to_vec()
        } else {
            b"(void{\"\\u0000eval\":this,__proto__:null".to_vec()
        };
        if has_arguments == Some(true) {
            text.extend_from_slice(b",arguments:arguments");
        }
        if is_sloppy {
            text.extend_from_slice(b",\"\\u0000sloppy\":1");
        }
        if let Some(Some(new_target)) = new_target {
            text.extend_from_slice(b",\"\\u0000target\":");
            text.extend_from_slice(new_target);
        }
        if is_in_field {
            text.extend_from_slice(b",\"\\u0000field\":1");
        }
        if has_super {
            text.extend_from_slice(b",\"\\u0000super\":1");
        }
        if !private_names.is_empty() && bun_core::strings::index_of_any(&private_names, b"\"\\").is_none() {
            text.extend_from_slice(b",\"\\u0000private\":\"");
            text.extend_from_slice(&private_names);
            text.push(b'"');
        }
        if bound.commonjs_indicator.is_some() {
            for (name, is_in_bundles) in [(&b"module"[..], true), (b"exports", true), (b"require", false), (b"__filename", false), (b"__dirname", false)] {
                if !names.iter().any(|it| self.atoms.bytes(it.0) == name) {
                    let is_in_bundles = is_in_bundles || name.starts_with(b"__") && self.is_free_name(name);
                    let (before, behind) = if is_in_bundles { (&b",get "[..], &b"(){return "[..]) } else { (&b",get \"\\u0000"[..], &b"\"(){return "[..]) };
                    for part in [before, name, behind, name, b"}"] {
                        text.extend_from_slice(part);
                    }
                }
            }
        } else {
            for name in [&b"__filename"[..], b"__dirname"] {
                if !names.iter().any(|it| self.atoms.bytes(it.0) == name) && self.is_free_name(name) {
                    for part in [&b",get "[..], name, b"(){return ", name, b"}"] {
                        text.extend_from_slice(part);
                    }
                }
            }
        }
        for (name, symbol) in names {
            let name = self.atoms.bytes(name);
            for part in [&b",get "[..], name, b"(){return ", name, b"}"] {
                text.extend_from_slice(part);
            }
            if self.is_assignable(symbol, pos) {
                for part in [&b",set "[..], name, b"(", &parameter, b"){", name, b"=", &parameter, b"}"] {
                    text.extend_from_slice(part);
                }
            } else {
                for part in [&b",set "[..], name, b"(", &parameter, b"){throw new TypeError(\"Attempted to assign to readonly property.\")}"] {
                    text.extend_from_slice(part);
                }
            }
        }
        text.extend_from_slice(b"},");
        text
    }
}

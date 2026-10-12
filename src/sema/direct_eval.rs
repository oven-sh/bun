use crate::atom::{Atom, Interner};
use crate::bind::{Bound, Decl, PatParent, ScopeId, ScopeKind, SymFlags, SymbolId};
use crate::hir::{Chain, ExprId, ExprKind, File, FnBody, FnKind, IdList, StmtId, StmtKind, VarKind};
use crate::util::FxHashSet;

pub const KEY_OF_SCOPE: &[u8] = b"\0eval";

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
    insertions: Vec<(u32, Vec<u8>)>,
}

pub fn give_direct_evals_their_scopes<'s>(hir: &File<'s>, bound: &Bound<'s>, atoms: &Interner<'s>) -> Option<Vec<u8>> {
    if hir.has_errors || hir.text.is_empty() {
        return None;
    }
    let mut it = Rewriting { hir, bound, atoms, insertions: Vec::new() };
    it.add_scopes_of_direct_evals();
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
    Some(rewritten)
}

impl<'a, 's> Rewriting<'a, 's> {

    fn add_scopes_of_direct_evals(&mut self) {
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
            let object = self.object_for_scope(scope);
            self.insertions.push((hir[source].pos, object));
            self.insertions.push((hir[source].end, b")".to_vec()));
        }
    }

    fn is_assignable(&self, symbol: SymbolId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let of = &bound.symbols[symbol.idx()];
        if !of.flags.intersects(SymFlags::VARIABLE) {
            return hir.is_js && of.flags.contains(SymFlags::FUNCTION) && !of.flags.intersects(SymFlags::CLASS | SymFlags::ALIAS);
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
            match hir[stmt].kind {
                StmtKind::Expr(e) => match hir[e].kind {
                    ExprKind::String(text) if self.atoms.bytes(text) == b"use strict" => return true,
                    ExprKind::String(_) => {}
                    _ => return false,
                },
                _ => return false,
            }
        }
        false
    }

    fn object_for_scope(&self, innermost: ScopeId) -> Vec<u8> {
        let (hir, bound) = (self.hir, self.bound);
        let mut is_sloppy = bound.commonjs_indicator.is_some() && !self.starts_with_use_strict(hir.body);
        let mut names: Vec<(Atom, SymbolId)> = Vec::new();
        let mut seen: FxHashSet<Atom> = FxHashSet::default();
        let mut has_arguments = None;
        let mut has_new_target = None;
        let mut scope = innermost;
        while scope.is_some() {
            let at = &bound.scopes[scope.idx()];
            for &(name, symbol) in bound.table(at.locals) {
                let flags = bound.symbols[symbol.idx()].flags;
                let is_value = flags.intersects(SymFlags::VALUE) || hir.is_js && flags.contains(SymFlags::ALIAS);
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
            if has_new_target.is_none() {
                match at.kind {
                    ScopeKind::Fn(func) => has_new_target = Some(matches!(hir[func].kind, FnKind::Decl | FnKind::Expr | FnKind::Constructor)),
                    ScopeKind::Class(_) => has_new_target = Some(false),
                    _ => {}
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
        let is_this_of_module = has_arguments.is_none() && bound.commonjs_indicator.is_none();
        let mut text = if is_this_of_module { b"(void{\"\\u0000eval\":void 0,__proto__:null".to_vec() } else { b"(void{\"\\u0000eval\":this,__proto__:null".to_vec() };
        if has_arguments == Some(true) {
            text.extend_from_slice(b",arguments:arguments");
        }
        if is_sloppy {
            text.extend_from_slice(b",\"\\u0000sloppy\":1");
        }
        if has_new_target == Some(true) {
            text.extend_from_slice(b",\"\\u0000target\":new.target");
        }
        if bound.commonjs_indicator.is_some() {
            for (name, is_in_bundles) in [(&b"module"[..], true), (b"exports", true), (b"require", false), (b"__filename", false), (b"__dirname", false)] {
                if !names.iter().any(|it| self.atoms.bytes(it.0) == name) {
                    let (before, behind) = if is_in_bundles { (&b",get "[..], &b"(){return "[..]) } else { (&b",get \"\\u0000"[..], &b"\"(){return "[..]) };
                    for part in [before, name, behind, name, b"}"] {
                        text.extend_from_slice(part);
                    }
                }
            }
        }
        for (name, symbol) in names {
            let name = self.atoms.bytes(name);
            if !bound.symbols[symbol.idx()].flags.intersects(SymFlags::VALUE & !SymFlags::CONST_ENUM) && !hir.is_js {
                for part in [&b",get "[..], name, b"(){throw new ReferenceError(\"", name, b" is a const enum: a direct eval does not see it in a program that is compiled ahead of time\")}"] {
                    text.extend_from_slice(part);
                }
                continue;
            }
            for part in [&b",get "[..], name, b"(){return ", name, b"}"] {
                text.extend_from_slice(part);
            }
            if self.is_assignable(symbol) {
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

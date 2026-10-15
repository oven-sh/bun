use super::flows::OriginOfData;
use crate::bind::{Decl, Parent, PatParent};
use crate::check::{Checker, ContextFlags};
use crate::hir::{BinOp, ExprId, ExprKind, FileKind, PropKind, StmtKind};
use crate::program::FileId;
use crate::types::{TypeData, TypeId};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum AotCheckKind {
    AnyEnters,
    AnyIsStored,
    OutsideData,
}

#[derive(Clone, Debug)]
pub struct AotCheck {
    pub kind: AotCheckKind,
    pub type_text: Vec<u8>,
    pub origin: Vec<u8>,
}

impl<'p, 's> Checker<'p, 's> {
    fn stands_in_a_place_that_has_a_type(&self, file: FileId, e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        match bound.expr_parent[e.idx()] {
            Parent::VarInit(d) if hir[d].ty.is_some() => true,
            Parent::ParamDefault(p) if hir[p].ty.is_some() => true,
            Parent::MemberInit(m) if hir[m].ty.is_some() => true,
            Parent::FnBody(_) => true,
            Parent::Stmt(s) if matches!(hir[s].kind, StmtKind::Return(_)) => true,
            Parent::Prop(p) if matches!(hir[p].kind, PropKind::Init | PropKind::Shorthand) => true,
            Parent::Expr(parent) if parent.is_some() => match hir[parent].kind {
                ExprKind::Call(call) | ExprKind::New(call) => hir[call].callee != e,
                ExprKind::Array(_) => true,
                ExprKind::Yield { value, star: false } if value == e => true,
                ExprKind::Assign { op: None | Some(BinOp::And | BinOp::Or | BinOp::Nullish), value, .. } if value == e => true,
                _ => false,
            },
            _ => false,
        }
    }

    fn says_what_a_value_is(&mut self, ty: TypeId) -> bool {
        if self.says_nothing(ty) || self.is_error_type(ty) {
            return false;
        }
        self.parts(ty).to_vec().into_iter().all(|part| {
            let part = if self.is_instantiable(part) { self.base_constraint(part) } else { part };
            !part.is_any() && part != TypeId::UNKNOWN && part != TypeId::UNRESOLVED && !self.is_instantiable(part) && !self.is_empty_object_type(part)
        })
    }

    fn is_stored_in_a_container(&mut self, file: FileId, e: ExprId, target: TypeId) -> Option<bool> {
        let Parent::Expr(parent) = self.bound(file).expr_parent[e.idx()] else { return None };
        let hir = self.hir(file);
        let (ExprKind::Call(call) | ExprKind::New(call)) = hir[parent].kind else { return None };
        match self.resolved_signature(file, parent).sig.and_then(|sig| self.sig_decl(sig)) {
            Some((declared_in, ..)) if !self.only_declares(declared_in) => return None,
            _ => {}
        }
        let ExprKind::Dot { obj, .. } = hir[hir[call].callee].kind else { return Some(false) };
        let holder = self.type_of_expr(file, obj);
        Some(matches!(self.data(holder), TypeData::Ref { .. }) && self.type_arguments(holder).contains(&target))
    }

    pub fn check_where_any_enters(&mut self, file: FileId, e: ExprId) -> Option<AotCheck> {
        let hir = self.hir(file);
        if hir.is_js || hir.kind == FileKind::Declaration || !self.stands_in_a_place_that_has_a_type(file, e) || matches!(hir[e].kind, ExprKind::Missing | ExprKind::Spread(_) | ExprKind::Fn(_) | ExprKind::Class(_)) || self.is_never_checked(hir[e].pos) {
            return None;
        }
        self.prepare_enclosing(file, e);
        if self.type_of_expr(file, e) != TypeId::ANY {
            return None;
        }
        let target = self.contextual_type(file, e, ContextFlags::empty())?;
        if !self.says_what_a_value_is(target) {
            return None;
        }
        let kind = match self.is_stored_in_a_container(file, e, target) {
            None => AotCheckKind::AnyEnters,
            Some(true) => AotCheckKind::AnyIsStored,
            Some(false) => return None,
        };
        Some(AotCheck { kind, type_text: self.type_to_string(target), origin: Vec::new() })
    }

    pub fn check_where_outside_data_enters(&mut self, file: FileId, e: ExprId) -> Option<AotCheck> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let ExprKind::As { ty, .. } = hir[e].kind else { return None };
        if hir.is_js || matches!(bound.expr_parent[e.idx()], Parent::Expr(parent) if parent.is_some() && matches!(hir[parent].kind, ExprKind::As { .. })) {
            return None;
        }
        let inner = self.without_type_operators(file, e);
        if self.cached_type_of_expr(file, inner).is_some_and(|known| known != TypeId::ANY && known != TypeId::UNKNOWN) || self.is_never_checked(hir[e].pos) {
            return None;
        }
        self.prepare_enclosing(file, e);
        let operand = self.type_of_expr(file, inner);
        if operand != TypeId::ANY && operand != TypeId::UNKNOWN {
            return None;
        }
        let target = self.type_from_node(file, ty);
        if !self.says_what_a_value_is(target) {
            return None;
        }
        let origin: &[u8] = match self.origin_of_data_without_taint(file, inner)? {
            OriginOfData::Parsed => b"`JSON.parse()`",
            OriginOfData::JsonModule => b"a JSON file",
            OriginOfData::Prediction | OriginOfData::BuiltIn => b"code that is only declared",
            OriginOfData::Function => b"a function whose result has no type",
            OriginOfData::Annotated | OriginOfData::Inferred => b"a variable or a parameter that has no type",
            OriginOfData::Property => b"a property that has no type",
            OriginOfData::Awaited => b"a promise whose value has no type",
        };
        Some(AotCheck { kind: AotCheckKind::OutsideData, type_text: self.type_to_string(target), origin: origin.to_vec() })
    }

    pub fn where_an_any_comes_from(&mut self, file: FileId, e: ExprId) -> Vec<u8> {
        self.where_any_comes_from(file, file, e, 0).unwrap_or_default()
    }

    fn place_in_words(&self, asked_in: FileId, file: FileId, pos: u32) -> Vec<u8> {
        let text = &self.hir(file).text;
        let line = bun_core::strings::count_char(&text[..(pos as usize).min(text.len())], b'\n') + 1;
        if asked_in == file {
            return format!("line {line}").into_bytes();
        }
        let name = self.files().module(file).file_name();
        let name = name.rsplit(|&byte| byte == b'/').next().unwrap_or(name);
        [name, format!(":{line}").as_bytes()].concat()
    }

    fn where_any_comes_from(&mut self, asked_in: FileId, file: FileId, e: ExprId, depth: u32) -> Option<Vec<u8>> {
        let hir = self.hir(file);
        if depth > 8 {
            return None;
        }
        match hir[e].kind {
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } if self.type_of_expr(file, obj) == TypeId::ANY => self.where_any_comes_from(asked_in, file, obj, depth + 1),
            ExprKind::Await(operand) | ExprKind::NonNull(operand) | ExprKind::As { expr: operand, .. } => self.where_any_comes_from(asked_in, file, operand, depth + 1),
            ExprKind::Call(call) if self.type_of_expr(file, hir[call].callee) == TypeId::ANY => self.where_any_comes_from(asked_in, file, hir[call].callee, depth + 1),
            ExprKind::Ident(name) => {
                let sym = self.symbol_of_identifier(file, e, name)?;
                let (of, declared) = self.files().value_declaration(sym)?;
                let (declaring, bound) = (self.hir(of), self.bound(of));
                let Decl::Var(pat) = declared else { return None };
                let at = [b"`".as_slice(), self.atoms().bytes(name), b"`, declared at ", &self.place_in_words(asked_in, of, declaring[pat].pos)].concat();
                match bound.pat_parent[pat.idx()] {
                    PatParent::Var(d) if declaring[d].pat == pat && declaring[d].init.is_some() && bound.assignments_to(bound.pat_symbol[pat.idx()]).is_empty() => self.where_any_comes_from(asked_in, of, declaring[d].init, depth + 1).or(Some(at)),
                    _ => Some(at),
                }
            }
            _ if depth == 0 => None,
            _ => {
                let text = &hir.text[hir[e].pos as usize..(hir[e].end as usize).min(hir.text.len())];
                let text = String::from_utf8_lossy(text);
                let mut shown: String = text.chars().take_while(|&c| c != '\n').take(40).collect();
                if shown.len() < text.len() {
                    shown.push_str("..");
                }
                Some([b"`".as_slice(), shown.as_bytes(), b"` at ", &self.place_in_words(asked_in, file, hir[e].pos)].concat())
            }
        }
    }

    fn without_type_operators(&self, file: FileId, mut e: ExprId) -> ExprId {
        while let ExprKind::As { expr, .. } | ExprKind::NonNull(expr) | ExprKind::Satisfies { expr, .. } = self.hir(file)[e].kind {
            e = expr;
        }
        e
    }
}

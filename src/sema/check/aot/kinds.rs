use super::ByFile;
use super::integers::{Place, Store};
use crate::atom::{Atom, known};
use crate::bind::{Decl, Flow, FlowId, FlowTarget, FnOwner, Parent, PatParent, SymFlags, SymbolId, UNREACHABLE};
use crate::check::Checker;
use crate::check::errors::Container;
use crate::check::errors_names_and_exports::root_declaration;
use crate::hir::{BinOp, Chain, ExprId, ExprKind, ExprTag, Flags, FnBody, FnId, MemberId, MemberKind, PatKind, PropKey, Span, StmtId, StmtKind, TypeNodeKind, UnOp, VarKind};
use crate::program::{FileId, Sym};
use crate::types::TypeId;
use crate::util::{FxHashMap, FxHashSet};
use std::rc::Rc;
use std::sync::OnceLock;

pub mod kind {
    pub const UNDEFINED: u16 = 1;
    pub const NULL: u16 = 1 << 1;
    pub const BOOLEAN: u16 = 1 << 2;
    pub const NUMBER: u16 = 1 << 3;
    pub const STRING: u16 = 1 << 4;
    pub const BIGINT: u16 = 1 << 5;
    pub const SYMBOL: u16 = 1 << 6;
    pub const FUNCTION: u16 = 1 << 7;
    pub const ARRAY: u16 = 1 << 8;
    pub const OBJECT: u16 = 1 << 9;
    pub const ANYTHING: u16 = PLAIN | BIGINT | SYMBOL | OBJECTS;
    pub const NOTHING: u16 = 0;
    pub const PLAIN: u16 = UNDEFINED | NULL | BOOLEAN | NUMBER | STRING;
    pub const OBJECTS: u16 = FUNCTION | ARRAY | OBJECT;
}

#[derive(Default)]
pub(super) struct State {
    held: FxHashMap<FileId, FxHashMap<SymbolId, u16>>,
    tracked_variables: Vec<(SymbolId, Rc<Place>, bool)>,
    tracked_functions: Vec<FnId>,
    growing: Option<(FileId, FxHashMap<SymbolId, u16>)>,
    reads_of_growing: u64,
    returned: FxHashMap<FileId, FxHashMap<FnId, u16>>,
    returned_so_far: FxHashMap<FnId, u16>,
    produced: FxHashMap<(FileId, ExprId), u16>,
    produced_this_round: FxHashMap<ExprId, u16>,
    told: FxHashMap<Sym, Option<FlowCoverage>>,
    asserted: FxHashMap<(FileId, FnId, u32, u8), u16>,
    at_flow: FxHashMap<(Sym, FlowId), u16>,
    at_flow_this_round: FxHashMap<(SymbolId, FlowId), u16>,
    used_as: FxHashMap<Sym, Option<TypeId>>,
}

struct Uses {
    surely: FxHashSet<SymbolId>,
    otherwise: FxHashSet<SymbolId>,
    if_number: FxHashMap<SymbolId, Vec<ExprId>>,
}

impl Uses {
    fn holds_for(&self, name: SymbolId, mut is_number: impl FnMut(ExprId) -> bool) -> bool {
        !self.otherwise.contains(&name) && (self.surely.contains(&name) || self.if_number.get(&name).is_some_and(|deciding| deciding.iter().any(|&e| is_number(e))))
    }
}

#[derive(Default)]
pub(super) struct Shared {
    tested: ByFile<FxHashSet<SymbolId>>,
    used_as_numbers: ByFile<Uses>,
    used_as_arrays: ByFile<Uses>,
    used_as_strings: ByFile<FxHashSet<SymbolId>>,
    property_names_used: ByFile<FxHashMap<SymbolId, Vec<Atom>>>,
    declarations_by_property_name: OnceLock<FxHashMap<Atom, Vec<Sym>>>,
}

impl State {
    pub(super) fn is_stable(&self) -> bool {
        self.growing.is_none()
    }
}

#[derive(Copy, Clone)]
struct FlowCoverage {
    container: Container,
    is_constant: bool,
    begins_at: FlowId,
}

struct Walk {
    at: Sym,
    held: u16,
    is_constant: bool,
    is_of_read: bool,
    begins_at: FlowId,
    joins: FxHashMap<FlowId, u16>,
    steps: u32,
    depth: u8,
}

const MAX_STEPS: u32 = 20_000;
const MAX_DEPTH: u8 = 3;
const NULLISH: u16 = kind::UNDEFINED | kind::NULL;

fn typeof_kinds(name: &[u8]) -> (u16, u16) {
    let (called, never_otherwise) = match name {
        b"undefined" => (kind::UNDEFINED | kind::OBJECT, kind::UNDEFINED),
        b"object" => (kind::NULL | kind::ARRAY | kind::OBJECT, kind::NULL | kind::ARRAY),
        b"function" => (kind::FUNCTION, kind::FUNCTION),
        b"boolean" => (kind::BOOLEAN, kind::BOOLEAN),
        b"number" => (kind::NUMBER, kind::NUMBER),
        b"string" => (kind::STRING, kind::STRING),
        b"bigint" => (kind::BIGINT, kind::BIGINT),
        b"symbol" => (kind::SYMBOL, kind::SYMBOL),
        _ => (kind::NOTHING, kind::NOTHING),
    };
    (called, kind::ANYTHING & !never_otherwise)
}

const MATH_FUNCTIONS: [&[u8]; 35] = [
    b"abs", b"acos", b"acosh", b"asin", b"asinh", b"atan", b"atan2", b"atanh", b"cbrt", b"ceil", b"clz32", b"cos", b"cosh", b"exp", b"expm1", b"floor", b"fround", b"hypot",
    b"imul", b"log", b"log10", b"log1p", b"log2", b"max", b"min", b"pow", b"random", b"round", b"sign", b"sin", b"sinh", b"sqrt", b"tan", b"tanh", b"trunc",
];

fn numeric(a: u16, b: u16) -> u16 {
    if a == kind::NOTHING || b == kind::NOTHING {
        kind::NOTHING
    } else if a & !kind::PLAIN == 0 || b & !kind::PLAIN == 0 {
        kind::NUMBER
    } else if a == kind::BIGINT && b == kind::BIGINT {
        kind::BIGINT
    } else {
        kind::NUMBER | kind::BIGINT
    }
}

fn sum(a: u16, b: u16) -> u16 {
    const ADDED: u16 = kind::UNDEFINED | kind::NULL | kind::BOOLEAN | kind::NUMBER;
    if a == kind::NOTHING || b == kind::NOTHING {
        kind::NOTHING
    } else if a == kind::STRING || b == kind::STRING {
        kind::STRING
    } else if a & !ADDED == 0 && b & !ADDED == 0 {
        kind::NUMBER
    } else if a == kind::BIGINT && b == kind::BIGINT {
        kind::BIGINT
    } else if (a | b) & (kind::STRING | kind::OBJECTS) == 0 {
        numeric(a, b)
    } else if a & (kind::BIGINT | kind::OBJECTS) == 0 || b & (kind::BIGINT | kind::OBJECTS) == 0 {
        kind::NUMBER | kind::STRING
    } else {
        kind::NUMBER | kind::STRING | kind::BIGINT
    }
}

impl<'p, 's> Checker<'p, 's> {
    pub fn symbol_kinds(&mut self, at: Sym) -> u16 {
        if let Some(&known) = self.aot.kinds.held.get(&at.file).and_then(|held| held.get(&at.id)) {
            return known;
        }
        if let Some((file, so_far)) = &self.aot.kinds.growing
            && *file == at.file
        {
            let so_far = so_far.get(&at.id).copied();
            self.aot.kinds.reads_of_growing += 1;
            return match so_far {
                Some(so_far) => so_far,
                None if self.follow_variable(at) => kind::NOTHING,
                None => self.declared_kinds(at),
            };
        }
        self.converge_kinds(at.file, |c| {
            c.follow_variable(at);
        });
        match self.aot.kinds.held.get(&at.file).and_then(|held| held.get(&at.id)) {
            Some(&found) => found,
            None => self.declared_kinds(at),
        }
    }

    fn follow_variable(&mut self, at: Sym) -> bool {
        let is_variable = match self.bound(at.file).symbols.get(at.id.idx()).and_then(|symbol| symbol.decls.first()) {
            Some(Decl::Var(_)) => true,
            Some(Decl::Param(_) | Decl::Member(_)) => false,
            _ => return false,
        };
        let growing = self.aot.kinds.growing.take();
        let place = self.integer_slot(at);
        let starts_uninitialized = place.is_followed && place.starts_undefined && (!is_variable || self.starts_undefined(self.files().sym(at.file, at.id)));
        self.aot.kinds.growing = growing;
        if !place.is_followed {
            return false;
        }
        if let Some((_, so_far)) = &mut self.aot.kinds.growing {
            so_far.insert(at.id, kind::NOTHING);
        }
        self.aot.kinds.tracked_variables.push((at.id, place, starts_uninitialized));
        true
    }

    fn follow_function(&mut self, func: FnId) {
        self.aot.kinds.returned_so_far.insert(func, kind::NOTHING);
        self.aot.kinds.tracked_functions.push(func);
    }

    fn converge_kinds(&mut self, file: FileId, begin: impl FnOnce(&mut Self)) {
        let outer = self.aot.kinds.growing.replace((file, FxHashMap::default()));
        let outer_variables = std::mem::take(&mut self.aot.kinds.tracked_variables);
        let outer_functions = std::mem::take(&mut self.aot.kinds.tracked_functions);
        let outer_returned = std::mem::take(&mut self.aot.kinds.returned_so_far);
        let outer_produced = std::mem::take(&mut self.aot.kinds.produced_this_round);
        let outer_at_flow = std::mem::take(&mut self.aot.kinds.at_flow_this_round);
        begin(self);
        let (mut settled_functions, mut settled): (FxHashSet<FnId>, FxHashSet<SymbolId>) = Default::default();
        loop {
            let mut has_grown = false;
            let followed_before = (self.aot.kinds.tracked_functions.len(), self.aot.kinds.tracked_variables.len());
            self.aot.kinds.produced_this_round.clear();
            self.aot.kinds.at_flow_this_round.clear();
            let mut next = 0;
            while let Some(&func) = self.aot.kinds.tracked_functions.get(next) {
                next += 1;
                if self.aot.kinds.returned_so_far.get(&func) == Some(&kind::ANYTHING) || settled_functions.contains(&func) {
                    continue;
                }
                let reads = self.aot.kinds.reads_of_growing;
                let all = self.find_returned_kinds(file, func) | self.aot.kinds.returned_so_far.get(&func).copied().unwrap_or(kind::NOTHING);
                if self.aot.kinds.reads_of_growing == reads {
                    settled_functions.insert(func);
                }
                has_grown |= self.aot.kinds.returned_so_far.insert(func, all) != Some(all);
            }
            let mut next = 0;
            while let Some((id, place, starts_uninitialized)) = self.aot.kinds.tracked_variables.get(next).cloned() {
                next += 1;
                if matches!(&self.aot.kinds.growing, Some((_, so_far)) if so_far.get(&id) == Some(&kind::ANYTHING)) || settled.contains(&id) {
                    continue;
                }
                let reads = self.aot.kinds.reads_of_growing;
                let mut all = if starts_uninitialized { kind::UNDEFINED } else { kind::NOTHING };
                for &store in &place.stores {
                    all |= match store {
                        Store::Value(e) | Store::Computed(e) => self.result_kinds_of(file, e),
                        Store::Nil => kind::UNDEFINED,
                    };
                }
                if self.aot.kinds.reads_of_growing == reads {
                    settled.insert(id);
                }
                if let Some((_, so_far)) = &mut self.aot.kinds.growing {
                    let all = all | so_far.get(&id).copied().unwrap_or(kind::NOTHING);
                    has_grown |= so_far.insert(id, all) != Some(all);
                }
            }
            if !has_grown && followed_before == (self.aot.kinds.tracked_functions.len(), self.aot.kinds.tracked_variables.len()) {
                break;
            }
        }
        let held = std::mem::replace(&mut self.aot.kinds.growing, outer).map_or_else(Default::default, |it| it.1);
        self.aot.kinds.held.entry(file).or_default().extend(held);
        let returned = std::mem::replace(&mut self.aot.kinds.returned_so_far, outer_returned);
        self.aot.kinds.returned.entry(file).or_default().extend(returned);
        self.aot.kinds.tracked_variables = outer_variables;
        self.aot.kinds.tracked_functions = outer_functions;
        self.aot.kinds.produced_this_round = outer_produced;
        self.aot.kinds.at_flow_this_round = outer_at_flow;
    }

    pub fn returned_kinds(&mut self, file: FileId, func: FnId) -> u16 {
        if let Some(&known) = self.aot.kinds.returned.get(&file).and_then(|returned| returned.get(&func)) {
            return known;
        }
        if matches!(self.hir(file)[func].body, FnBody::None) {
            return kind::ANYTHING;
        }
        if matches!(&self.aot.kinds.growing, Some((growing, _)) if *growing == file) {
            self.aot.kinds.reads_of_growing += 1;
            if let Some(&so_far) = self.aot.kinds.returned_so_far.get(&func) {
                return so_far;
            }
            self.follow_function(func);
            return kind::NOTHING;
        }
        self.converge_kinds(file, |c| c.follow_function(func));
        self.aot.kinds.returned.get(&file).and_then(|returned| returned.get(&func)).copied().unwrap_or(kind::ANYTHING)
    }

    fn find_returned_kinds(&mut self, file: FileId, func: FnId) -> u16 {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if hir[func].flags.intersects(Flags::ASYNC | Flags::GENERATOR) {
            return kind::OBJECT;
        }
        if let FnBody::Expr(value) = hir[func].body {
            return self.result_kinds_of(file, value);
        }
        let mut all = if bound.fns[func.idx()].end == UNREACHABLE { kind::NOTHING } else { kind::UNDEFINED };
        for stmt in bound.ids(bound.fns[func.idx()].returns) {
            if let StmtKind::Return(value) = hir[stmt].kind {
                all |= if value.is_some() { self.result_kinds_of(file, value) } else { kind::UNDEFINED };
            }
        }
        all
    }

    fn function_for_name_syntactically(&self, file: FileId, e: ExprId) -> Option<FnId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let local = bound.expr_symbol[e.idx()].some()?;
        let symbol = &bound.symbols[local.idx()];
        if symbol.flags.intersects(SymFlags::MERGED | SymFlags::ASSIGNED | SymFlags::ALIAS) || !bound.assignments_to(local).is_empty() || self.has_direct_eval(file) {
            return None;
        }
        if let [Decl::Var(pat)] = symbol.decls[..] {
            let PatParent::Var(declaration) = bound.pat_parent[pat.idx()] else { return None };
            return match hir[hir[declaration].init.some()?].kind {
                ExprKind::Fn(func) if hir[declaration].kind == VarKind::Const => Some(func),
                _ => None,
            };
        }
        let mut bodies = symbol.decls.iter().filter_map(|decl| match *decl {
            Decl::Fn(func) if !matches!(hir[func].body, FnBody::None) => Some(Some(func)),
            Decl::Fn(_) => None,
            _ => Some(None),
        });
        let (Some(Some(func)), None) = (bodies.next(), bodies.next()) else { return None };
        let FnOwner::Stmt(stmt) = bound.fns[func.idx()].owner else { return None };
        (!hir.is_js || matches!(bound.stmt_parent[stmt.idx()], Parent::File | Parent::FnBody(_))).then_some(func)
    }

    pub(super) fn is_used_as_number(&mut self, at: Sym) -> bool {
        let program = self.p;
        let uses = program.aot.kinds.used_as_numbers.get_or_init(program.files.modules.len(), at.file, || self.find_number_like_names(at.file));
        uses.holds_for(at.id, |beside| self.result_kinds_of(at.file, beside) == kind::NUMBER)
    }

    fn find_number_like_names(&self, file: FileId) -> Uses {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (mut as_numbers, mut otherwise): (FxHashSet<SymbolId>, FxHashSet<SymbolId>) = Default::default();
        let mut if_number: FxHashMap<SymbolId, Vec<ExprId>> = FxHashMap::default();
        for &e in self.file_exprs_by_kind(file).of(ExprTag::Ident) {
            let symbol = bound.expr_symbol[e.idx()];
            let Parent::Expr(parent) = bound.expr_parent[e.idx()] else { continue };
            if symbol.is_none() || parent.is_none() {
                continue;
            }
            match hir[parent].kind {
                ExprKind::Binary { op: BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge, left, right } => {
                    if_number.entry(symbol).or_default().push(if left == e { right } else { left });
                }
                ExprKind::Binary { op, .. } | ExprKind::Assign { op: Some(op), .. }
                    if matches!(op, BinOp::Sub | BinOp::Mul | BinOp::Div | BinOp::Rem | BinOp::Pow | BinOp::Shl | BinOp::Shr | BinOp::UShr | BinOp::BitAnd | BinOp::BitOr | BinOp::BitXor) =>
                {
                    as_numbers.insert(symbol);
                }
                ExprKind::Unary { op: UnOp::Minus | UnOp::BitNot | UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec, .. } => {
                    as_numbers.insert(symbol);
                }
                ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } if obj == e => {
                    otherwise.insert(symbol);
                }
                ExprKind::Call(call) | ExprKind::New(call) if hir[call].callee == e => {
                    otherwise.insert(symbol);
                }
                _ => {}
            }
        }
        Uses { surely: as_numbers, otherwise, if_number }
    }

    pub(super) fn is_used_as_array(&mut self, at: Sym) -> bool {
        let program = self.p;
        let uses = program.aot.kinds.used_as_arrays.get_or_init(program.files.modules.len(), at.file, || self.find_array_like_names(at.file));
        uses.holds_for(at.id, |index| self.result_kinds_of(at.file, index) == kind::NUMBER)
    }

    fn find_array_like_names(&self, file: FileId) -> Uses {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (mut as_arrays, mut otherwise): (FxHashSet<SymbolId>, FxHashSet<SymbolId>) = Default::default();
        let mut if_number: FxHashMap<SymbolId, Vec<ExprId>> = FxHashMap::default();
        for &e in self.file_exprs_by_kind(file).of(ExprTag::Ident) {
            let symbol = bound.expr_symbol[e.idx()];
            let Parent::Expr(parent) = bound.expr_parent[e.idx()] else { continue };
            if symbol.is_none() || parent.is_none() {
                continue;
            }
            match hir[parent].kind {
                ExprKind::Index { obj, index, .. } if obj == e => {
                    if_number.entry(symbol).or_default().push(index);
                }
                ExprKind::Dot { obj, name, .. } if obj == e => match self.atoms().bytes(name) {
                    b"push" | b"pop" | b"shift" | b"unshift" | b"splice" | b"forEach" | b"map" | b"filter" | b"reduce" | b"reduceRight" | b"join" | b"sort" | b"reverse" | b"every" | b"some" | b"find" | b"findIndex" | b"flat" | b"flatMap" | b"fill" => {
                        as_arrays.insert(symbol);
                    }
                    b"charCodeAt" | b"charAt" | b"codePointAt" | b"substring" | b"substr" | b"toLowerCase" | b"toUpperCase" | b"trim" | b"trimStart" | b"trimEnd" | b"split" | b"replace" | b"replaceAll" | b"match" | b"matchAll" | b"search" | b"startsWith"
                    | b"endsWith" | b"padStart" | b"padEnd" | b"repeat" | b"localeCompare" | b"normalize" | b"byteLength" | b"buffer" | b"byteOffset" | b"subarray" | b"callee" => {
                        otherwise.insert(symbol);
                    }
                    _ => {}
                },
                ExprKind::Binary { op, .. } | ExprKind::Assign { op: Some(op), .. } if !matches!(op, BinOp::EqEqEq | BinOp::NotEqEq | BinOp::EqEq | BinOp::NotEq | BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma | BinOp::Instanceof | BinOp::In) => {
                    otherwise.insert(symbol);
                }
                ExprKind::Call(call) | ExprKind::New(call) if hir[call].callee == e => {
                    otherwise.insert(symbol);
                }
                _ => {}
            }
        }
        Uses { surely: as_arrays, otherwise, if_number }
    }

    pub(super) fn is_string_only_method(&self, name: Atom) -> bool {
        matches!(
            self.atoms().bytes(name),
            b"charCodeAt"
                | b"codePointAt"
                | b"charAt"
                | b"toLowerCase"
                | b"toUpperCase"
                | b"toLocaleLowerCase"
                | b"toLocaleUpperCase"
                | b"startsWith"
                | b"endsWith"
                | b"padStart"
                | b"padEnd"
                | b"trim"
                | b"trimStart"
                | b"trimEnd"
                | b"repeat"
                | b"split"
                | b"normalize"
                | b"localeCompare"
                | b"replace"
                | b"replaceAll"
                | b"match"
                | b"matchAll"
                | b"search"
                | b"substring"
                | b"substr"
                | b"isWellFormed"
                | b"toWellFormed"
        )
    }

    pub(super) fn is_used_as_string(&mut self, at: Sym) -> bool {
        let program = self.p;
        program.aot.kinds.used_as_strings.get_or_init(program.files.modules.len(), at.file, || self.find_string_like_names(at.file)).contains(&at.id)
    }

    fn find_string_like_names(&self, file: FileId) -> FxHashSet<SymbolId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (mut as_strings, mut otherwise): (FxHashSet<SymbolId>, FxHashSet<SymbolId>) = Default::default();
        for &e in self.file_exprs_by_kind(file).of(ExprTag::Ident) {
            let symbol = bound.expr_symbol[e.idx()];
            let Parent::Expr(parent) = bound.expr_parent[e.idx()] else { continue };
            if symbol.is_none() || parent.is_none() {
                continue;
            }
            match hir[parent].kind {
                ExprKind::Dot { obj, name, .. } if obj == e => {
                    if self.is_string_only_method(name) {
                        as_strings.insert(symbol);
                    } else if matches!(
                        self.atoms().bytes(name),
                        b"push" | b"pop" | b"shift" | b"unshift" | b"splice" | b"forEach" | b"map" | b"filter" | b"reduce" | b"reduceRight" | b"join" | b"sort" | b"reverse" | b"every" | b"some" | b"find" | b"findIndex" | b"flat" | b"flatMap" | b"fill"
                    ) {
                        otherwise.insert(symbol);
                    }
                }
                ExprKind::Binary { op, .. } | ExprKind::Assign { op: Some(op), .. }
                    if matches!(op, BinOp::Sub | BinOp::Mul | BinOp::Div | BinOp::Rem | BinOp::Pow | BinOp::Shl | BinOp::Shr | BinOp::UShr | BinOp::BitAnd | BinOp::BitOr | BinOp::BitXor) =>
                {
                    otherwise.insert(symbol);
                }
                ExprKind::Call(call) | ExprKind::New(call) if hir[call].callee == e => {
                    otherwise.insert(symbol);
                }
                _ => {}
            }
        }
        as_strings.retain(|symbol| !otherwise.contains(symbol));
        as_strings
    }

    pub(super) fn declared_type_used_as(&mut self, at: Sym) -> Option<TypeId> {
        if self.is_untyped_file(at.file) {
            return None;
        }
        if let Some(&known) = self.aot.kinds.used_as.get(&at) {
            return known;
        }
        let found = self.find_declared_type_used_as(at);
        self.aot.kinds.used_as.insert(at, found);
        found
    }

    fn find_declared_type_used_as(&mut self, at: Sym) -> Option<TypeId> {
        const MAX_DECLARATIONS: usize = 8;
        let program = self.p;
        let names = program.aot.kinds.property_names_used.get_or_init(program.files.modules.len(), at.file, || self.find_property_names_used(at.file)).get(&at.id)?;
        let declaring = self.declarations_by_property_name();
        let rarest = names.iter().filter_map(|name| declaring.get(name)).min_by_key(|declarations| declarations.len())?;
        if rarest.len() > MAX_DECLARATIONS {
            return None;
        }
        let mut only = None;
        for &declaration in rarest {
            let declared = self.declared_type(declaration);
            if Some(declared) == only || !names.iter().all(|&name| self.type_of_property(declared, name).is_some()) {
                continue;
            }
            if only.is_some() {
                return None;
            }
            only = Some(declared);
        }
        only
    }

    fn find_property_names_used(&self, file: FileId) -> FxHashMap<SymbolId, Vec<Atom>> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut used: FxHashMap<SymbolId, Vec<Atom>> = FxHashMap::default();
        for &e in self.file_exprs_by_kind(file).of(ExprTag::Ident) {
            let symbol = bound.expr_symbol[e.idx()];
            let Parent::Expr(parent) = bound.expr_parent[e.idx()] else { continue };
            if symbol.is_none() || parent.is_none() {
                continue;
            }
            if let ExprKind::Dot { obj, name, .. } = hir[parent].kind
                && obj == e
            {
                let names = used.entry(symbol).or_default();
                if !names.contains(&name) {
                    names.push(name);
                }
            }
        }
        used
    }

    fn declarations_by_property_name(&self) -> &'p FxHashMap<Atom, Vec<Sym>> {
        self.p.aot.kinds.declarations_by_property_name.get_or_init(|| {
            let mut declaring: FxHashMap<Atom, Vec<Sym>> = FxHashMap::default();
            for file in self.files_declaring_classes() {
                if self.is_untyped_file(file) {
                    continue;
                }
                let (hir, bound) = (self.hir(file), self.bound(file));
                let mut add = |members: Span<MemberId>, id: SymbolId| {
                    let declaration = Sym { file, id };
                    for m in members.iter().map(|member| &hir[member]) {
                        if let PropKey::Name(name) = m.key
                            && m.kind == MemberKind::Property
                            && !m.flags.contains(Flags::STATIC)
                            && id.is_some()
                        {
                            let declarations = declaring.entry(name).or_default();
                            if declarations.last() != Some(&declaration) {
                                declarations.push(declaration);
                            }
                        }
                    }
                };
                for (index, class) in hir.classes.iter().enumerate() {
                    if class.type_params.is_empty() && !class.flags.contains(Flags::AMBIENT) {
                        add(class.members, bound.class_symbol[index]);
                    }
                }
                for (index, interface) in hir.interfaces.iter().enumerate() {
                    if interface.type_params.is_empty() {
                        add(interface.members, bound.interface_symbol[index]);
                    }
                }
                for (index, alias) in hir.aliases.iter().enumerate() {
                    if let TypeNodeKind::Object(members) = hir[alias.ty].kind
                        && alias.type_params.is_empty()
                    {
                        add(members, bound.alias_symbol[index]);
                    }
                }
            }
            declaring
        })
    }

    fn declared_kinds(&mut self, at: Sym) -> u16 {
        let (hir, bound) = (self.hir(at.file), self.bound(at.file));
        let Some(symbol) = bound.symbols.get(at.id.idx()) else { return kind::ANYTHING };
        let is_more = SymFlags::VALUE.difference(SymFlags::FUNCTION) | SymFlags::MERGED | SymFlags::ASSIGNED | SymFlags::ALIAS;
        let is_function = !hir.is_js && !symbol.decls.is_empty() && symbol.decls.iter().all(|decl| matches!(decl, Decl::Fn(_)));
        if is_function && !symbol.flags.intersects(is_more) && bound.assignments_to(at.id).is_empty() && !self.has_direct_eval(at.file) { kind::FUNCTION } else { kind::ANYTHING }
    }

    fn variable_flow_coverage(&mut self, at: Sym) -> Option<FlowCoverage> {
        if let Some(&known) = self.aot.kinds.told.get(&at) {
            return known;
        }
        let found = self.find_variable_flow_coverage(at);
        self.aot.kinds.told.insert(at, found);
        found
    }

    fn find_variable_flow_coverage(&mut self, at: Sym) -> Option<FlowCoverage> {
        let file = at.file;
        let (hir, bound) = (self.hir(file), self.bound(file));
        let symbol = bound.symbols.get(at.id.idx())?;
        if symbol.flags.intersects(SymFlags::MERGED | SymFlags::ALIAS) || self.is_stored_through_assertions(file, at.id) || self.has_direct_eval(file) {
            return None;
        }
        let [decl] = symbol.decls[..] else { return None };
        let mut begins_at = FlowId::NONE;
        let (container, is_parameter) = match decl {
            Decl::Var(pat) | Decl::Require(pat) => {
                let PatParent::Var(d) = root_declaration(bound, pat) else { return None };
                let stmt = bound.var_stmt[d.idx()].some()?;
                if matches!(hir[stmt].kind, StmtKind::Try { .. }) {
                    begins_at = bound.stmt_flow[stmt.idx()];
                }
                (self.flow_container(file, bound.stmt_parent[stmt.idx()]), false)
            }
            Decl::Param(pat) => {
                let PatParent::Param(p) = root_declaration(bound, pat) else { return None };
                let func = bound.param_fn[p.idx()];
                let is_replaced = matches!(hir[func].body, FnBody::Block(body) if hir.ids(body).any(|stmt| matches!(hir[stmt].kind, StmtKind::Fn(inner) if hir[inner].name == symbol.name)));
                if is_replaced || self.mentions_arguments_object(file, func) {
                    return None;
                }
                (Container::Fn(func), true)
            }
            _ => return None,
        };
        match container {
            Container::Fn(_) | Container::Member(_) => {}
            Container::File if self.files().module(file).is_module() => {}
            _ => return None,
        }
        let stores = bound.assignments_to(at.id);
        if stores.iter().any(|&(_, target)| self.flow_container(file, bound.expr_parent[target.idx()]) != container || self.is_outside_flow_graph(file, target)) {
            return None;
        }
        let is_constant = stores.is_empty() && (is_parameter || !self.starts_undefined(self.files().sym(file, at.id)));
        Some(FlowCoverage { container, is_constant, begins_at })
    }

    fn is_tested(&mut self, at: Sym) -> bool {
        let program = self.p;
        program.aot.kinds.tested.get_or_init(program.files.modules.len(), at.file, || self.find_tested_names(at.file)).contains(&at.id)
    }

    fn find_tested_names(&self, file: FileId) -> FxHashSet<SymbolId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut tested: FxHashSet<SymbolId> = FxHashSet::default();
        for &e in self.file_exprs_by_kind(file).of(ExprTag::Ident) {
            let symbol = bound.expr_symbol[e.idx()];
            if symbol.is_none() {
                continue;
            }
            let is_tested = match bound.expr_parent[e.idx()] {
                Parent::Expr(parent) if parent.is_some() => match hir[parent].kind {
                    ExprKind::Unary { op: UnOp::Typeof | UnOp::Not, .. } => true,
                    ExprKind::Binary { op, .. } => matches!(op, BinOp::EqEqEq | BinOp::NotEqEq | BinOp::EqEq | BinOp::NotEq | BinOp::And | BinOp::Or),
                    ExprKind::Cond { test, .. } => test == e,
                    ExprKind::Call(call) => hir[call].callee != e,
                    _ => false,
                },
                Parent::Stmt(parent) if parent.is_some() => matches!(hir[parent].kind, StmtKind::If { .. } | StmtKind::While { .. } | StmtKind::DoWhile { .. } | StmtKind::For { .. } | StmtKind::Switch { .. }),
                _ => false,
            };
            if is_tested {
                tested.insert(symbol);
            }
        }
        tested
    }

    fn read_kinds(&mut self, file: FileId, e: ExprId, id: SymbolId) -> u16 {
        let at = Sym { file, id };
        let held = self.symbol_kinds(at);
        if held == kind::NOTHING || !self.is_tested(at) {
            return held;
        }
        let Some(told) = self.variable_flow_coverage(at) else { return held };
        let bound = self.bound(file);
        let flow = bound.expr_flow[e.idx()];
        let is_read_elsewhere = told.container != self.flow_container(file, bound.expr_parent[e.idx()]);
        if is_read_elsewhere && !told.is_constant || flow.is_none() || flow == UNREACHABLE || self.is_outside_flow_graph(file, e) {
            return held;
        }
        let mut walk = Walk { at, held, is_constant: told.is_constant, is_of_read: true, begins_at: told.begins_at, joins: FxHashMap::default(), steps: 0, depth: 0 };
        self.kinds_at(&mut walk, flow)
    }

    fn kinds_at(&mut self, walk: &mut Walk, start: FlowId) -> u16 {
        if !walk.is_of_read {
            return self.find_kinds_at(walk, start);
        }
        let is_growing = matches!(&self.aot.kinds.growing, Some((growing, _)) if *growing == walk.at.file);
        let known = if is_growing { self.aot.kinds.at_flow_this_round.get(&(walk.at.id, start)) } else { self.aot.kinds.at_flow.get(&(walk.at, start)) };
        if let Some(&known) = known {
            self.aot.kinds.reads_of_growing += u64::from(is_growing);
            return known;
        }
        let found = self.find_kinds_at(walk, start);
        if is_growing {
            self.aot.kinds.at_flow_this_round.insert((walk.at.id, start), found);
        } else {
            self.aot.kinds.at_flow.insert((walk.at, start), found);
        }
        found
    }

    fn find_kinds_at(&mut self, walk: &mut Walk, start: FlowId) -> u16 {
        let file = walk.at.file;
        let bound = self.bound(file);
        let mut passing = kind::ANYTHING;
        let mut flow = start;
        let found = loop {
            walk.steps += 1;
            if walk.steps > MAX_STEPS || flow == walk.begins_at || self.is_half_of_stack_in_use() {
                break walk.held;
            }
            match bound.flow[flow.idx()] {
                Flow::Unreachable => break kind::NOTHING,
                Flow::Start { outer, .. } | Flow::StartInvoked { outer, .. } => {
                    if !walk.is_constant || outer.is_none() || outer == UNREACHABLE {
                        break walk.held;
                    }
                    flow = outer;
                }
                Flow::Assign { before, target } => {
                    if self.is_store_to_slot(walk.at, target) {
                        break self.kinds_at_assignment(file, target) & walk.held;
                    }
                    flow = before;
                }
                Flow::Cond { before, expr, sense } => {
                    passing &= self.kinds_after_test(file, expr, sense, walk.at.id);
                    flow = before;
                }
                Flow::Switch { before, stmt, from, to } => {
                    passing &= self.kinds_in_switch_clauses(file, stmt, from, to, walk.at.id);
                    flow = before;
                }
                Flow::Call { before, call } => {
                    passing &= self.kinds_after_call(file, call, walk.at.id, walk.depth);
                    flow = before;
                }
                Flow::Reduce { before, .. } | Flow::ArrayMutation { before, .. } => flow = before,
                Flow::Label { start, len } => {
                    if let Some(&known) = walk.joins.get(&flow) {
                        break known;
                    }
                    let mut all = kind::NOTHING;
                    for &edge in bound.edges(start, len) {
                        all |= self.kinds_at(walk, edge);
                    }
                    walk.joins.insert(flow, all);
                    break all;
                }
                Flow::Loop { start, len } => match *bound.edges(start, len) {
                    [] => break kind::NOTHING,
                    [entry] => flow = entry,
                    [entry, ..] => {
                        if self.is_assigned_in_loop(walk.at, flow) {
                            break walk.held;
                        }
                        flow = entry;
                    }
                },
            }
        };
        found & passing
    }

    fn kinds_at_assignment(&mut self, file: FileId, target: FlowTarget) -> u16 {
        let hir = self.hir(file);
        match target {
            FlowTarget::Var(d) if hir[d].init.is_some() && matches!(hir[hir[d].pat].kind, PatKind::Ident(_)) => self.result_kinds_of(file, hir[d].init),
            FlowTarget::Var(_) | FlowTarget::Pat(_) => kind::ANYTHING,
            FlowTarget::Expr(e) => match self.target_store(file, e) {
                Some(Store::Value(stored) | Store::Computed(stored)) => self.result_kinds_of(file, stored),
                Some(Store::Nil) => kind::UNDEFINED,
                None => kind::ANYTHING,
            },
        }
    }

    fn literal_kind(&self, file: FileId, e: ExprId) -> u16 {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Null => kind::NULL,
            ExprKind::Ident(name) if name == known::undefined && self.bound(file).expr_symbol[e.idx()].is_none() => kind::UNDEFINED,
            ExprKind::Unary { op: UnOp::Void, operand } if matches!(hir[operand].kind, ExprKind::Number(_)) => kind::UNDEFINED,
            ExprKind::True | ExprKind::False => kind::BOOLEAN,
            ExprKind::Number(_) => kind::NUMBER,
            ExprKind::String(_) => kind::STRING,
            ExprKind::BigInt(_) => kind::BIGINT,
            _ => kind::NOTHING,
        }
    }

    fn kinds_after_test(&mut self, file: FileId, test: ExprId, holds: bool, id: SymbolId) -> u16 {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let references_it = |e: ExprId| matches!(hir[e].kind, ExprKind::Ident(_)) && bound.expr_symbol[e.idx()] == id;
        if bound.assignments_to(id).iter().any(|&(_, target)| hir[target].pos >= hir[test].pos && hir[target].end <= hir[test].end) {
            return kind::ANYTHING;
        }
        match hir[test].kind {
            ExprKind::Ident(_) if references_it(test) => kind::ANYTHING & !(if holds { NULLISH } else { kind::SYMBOL | kind::FUNCTION | kind::ARRAY }),
            ExprKind::Unary { op: UnOp::Not, operand } => self.kinds_after_test(file, operand, !holds, id),
            ExprKind::Binary { op: op @ (BinOp::EqEqEq | BinOp::NotEqEq | BinOp::EqEq | BinOp::NotEq), left, right } => {
                let is_equal = matches!(op, BinOp::EqEqEq | BinOp::EqEq) == holds;
                let is_strict = matches!(op, BinOp::EqEqEq | BinOp::NotEqEq);
                for (one, other) in [(left, right), (right, left)] {
                    if let (ExprKind::Unary { op: UnOp::Typeof, operand }, ExprKind::String(name)) = (hir[one].kind, hir[other].kind)
                        && references_it(operand)
                    {
                        let (called, otherwise) = typeof_kinds(self.atoms().bytes(name));
                        return if is_equal { called } else { otherwise };
                    }
                    let compared_with = self.literal_kind(file, other);
                    if !references_it(one) || compared_with == kind::NOTHING {
                        continue;
                    }
                    return match (compared_with & NULLISH != 0, is_strict, is_equal) {
                        (_, true, true) => compared_with,
                        (true, true, false) => kind::ANYTHING & !compared_with,
                        (true, false, true) => NULLISH | kind::OBJECT,
                        (true, false, false) => kind::ANYTHING & !NULLISH,
                        _ => kind::ANYTHING,
                    };
                }
                kind::ANYTHING
            }
            ExprKind::Call(call) if hir[call].chain == Chain::No && hir.ids(hir[call].args).next().is_some_and(references_it) => {
                let ExprKind::Dot { obj, name, chain: Chain::No, .. } = hir[hir[call].callee].kind else { return kind::ANYTHING };
                match self.atoms().bytes(name) {
                    b"isInteger" | b"isSafeInteger" | b"isFinite" | b"isNaN" if holds && self.refers_to_global_object(file, obj, b"Number") => kind::NUMBER,
                    b"isArray" if self.refers_to_global_object(file, obj, b"Array") => kind::ANYTHING & if holds { kind::ARRAY | kind::OBJECT } else { !kind::ARRAY },
                    _ => kind::ANYTHING,
                }
            }
            _ => kind::ANYTHING,
        }
    }

    fn kinds_after_call(&mut self, file: FileId, call: ExprId, id: SymbolId, depth: u8) -> u16 {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let ExprKind::Call(c) = hir[call].kind else { return kind::ANYTHING };
        let c = &hir[c];
        let is_stored_to = bound.assignments_to(id).iter().any(|&(_, target)| hir[target].pos >= hir[call].pos && hir[target].end <= hir[call].end);
        if c.chain != Chain::No || is_stored_to || !matches!(hir[c.callee].kind, ExprKind::Ident(_)) {
            return kind::ANYTHING;
        }
        let Some(func) = self.function_for_name_syntactically(file, c.callee) else { return kind::ANYTHING };
        let mut passing = kind::ANYTHING;
        for (index, argument) in hir.ids(c.args).enumerate() {
            match hir[argument].kind {
                ExprKind::Spread(_) => break,
                ExprKind::Ident(_) if bound.expr_symbol[argument.idx()] == id => passing &= self.asserted_kinds(file, func, index, depth),
                _ => {}
            }
        }
        passing
    }

    fn asserted_kinds(&mut self, file: FileId, func: FnId, index: usize, depth: u8) -> u16 {
        if let Some(&known) = self.aot.kinds.asserted.get(&(file, func, index as u32, depth)) {
            return known;
        }
        let found = self.find_asserted_kinds(file, func, index, depth);
        self.aot.kinds.asserted.insert((file, func, index as u32, depth), found);
        found
    }

    fn find_asserted_kinds(&mut self, file: FileId, func: FnId, index: usize, depth: u8) -> u16 {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let f = &hir[func];
        if depth >= MAX_DEPTH || f.flags.intersects(Flags::ASYNC | Flags::GENERATOR) || !matches!(f.body, FnBody::Block(_)) {
            return kind::ANYTHING;
        }
        let Some(p) = f.params.iter().nth(index) else { return kind::ANYTHING };
        if hir[p].default.is_some() || hir[p].flags.contains(Flags::REST) || !matches!(hir[hir[p].pat].kind, PatKind::Ident(_)) {
            return kind::ANYTHING;
        }
        let at = Sym { file, id: bound.pat_symbol[hir[p].pat.idx()] };
        if at.id.is_none() || !self.variable_flow_coverage(at).is_some_and(|told| told.is_constant) {
            return kind::ANYTHING;
        }
        let info = bound.fns[func.idx()];
        let mut exits: Vec<FlowId> = bound.ids(info.returns).map(|stmt| bound.stmt_flow[stmt.idx()]).collect();
        if info.end != UNREACHABLE {
            exits.push(info.end);
        }
        let mut all = kind::NOTHING;
        for exit in exits {
            if exit.is_none() {
                return kind::ANYTHING;
            }
            let mut walk = Walk { at, held: kind::ANYTHING, is_constant: false, is_of_read: false, begins_at: FlowId::NONE, joins: FxHashMap::default(), steps: 0, depth: depth + 1 };
            all |= self.kinds_at(&mut walk, exit);
        }
        all
    }

    fn kinds_in_switch_clauses(&mut self, file: FileId, stmt: StmtId, from: u16, to: u16, id: SymbolId) -> u16 {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let StmtKind::Switch { expr, cases } = hir[stmt].kind else { return kind::ANYTHING };
        let references_it = |e: ExprId| matches!(hir[e].kind, ExprKind::Ident(_)) && bound.expr_symbol[e.idx()] == id;
        let is_typeof = matches!(hir[expr].kind, ExprKind::Unary { op: UnOp::Typeof, operand } if references_it(operand));
        if from >= to || !is_typeof && !references_it(expr) {
            return kind::ANYTHING;
        }
        let mut all = kind::NOTHING;
        for case in cases.iter().skip(from as usize).take((to - from) as usize) {
            let test = hir[case].test;
            all |= match test.some().map(|test| hir[test].kind) {
                Some(ExprKind::String(name)) if is_typeof => typeof_kinds(self.atoms().bytes(name)).0,
                Some(_) if !is_typeof && self.literal_kind(file, test) != kind::NOTHING => self.literal_kind(file, test),
                _ => return kind::ANYTHING,
            };
        }
        all
    }

    pub fn result_kinds_of(&mut self, file: FileId, e: ExprId) -> u16 {
        if matches!(&self.aot.kinds.growing, Some((growing, _)) if *growing == file) {
            if let Some(&known) = self.aot.kinds.produced_this_round.get(&e) {
                self.aot.kinds.reads_of_growing += 1;
                return known;
            }
            let found = self.find_result_kinds_of(file, e);
            self.aot.kinds.produced_this_round.insert(e, found);
            return found;
        }
        if self.aot.kinds.growing.is_some() {
            return self.find_result_kinds_of(file, e);
        }
        if let Some(&known) = self.aot.kinds.produced.get(&(file, e)) {
            return known;
        }
        let found = self.find_result_kinds_of(file, e);
        self.aot.kinds.produced.insert((file, e), found);
        found
    }

    fn find_result_kinds_of(&mut self, file: FileId, e: ExprId) -> u16 {
        if self.is_half_of_stack_in_use() {
            return kind::ANYTHING;
        }
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Null => kind::NULL,
            ExprKind::True | ExprKind::False => kind::BOOLEAN,
            ExprKind::Number(_) => kind::NUMBER,
            ExprKind::String(_) | ExprKind::Template { .. } => kind::STRING,
            ExprKind::BigInt(_) => kind::BIGINT,
            ExprKind::Regex | ExprKind::Object(_) => kind::OBJECT,
            ExprKind::Array(_) => kind::ARRAY,
            ExprKind::Fn(_) | ExprKind::Class(_) => kind::FUNCTION,
            ExprKind::New(_) => kind::OBJECTS,
            ExprKind::Ident(name) => {
                let local = self.bound(file).expr_symbol[e.idx()];
                if local.is_none() {
                    return match self.atoms().bytes(name) {
                        _ if name == known::undefined => kind::UNDEFINED,
                        b"NaN" | b"Infinity" => kind::NUMBER,
                        _ => kind::ANYTHING,
                    };
                }
                let flags = self.bound(file).symbols[local.idx()].flags;
                if flags.intersects(SymFlags::ALIAS | SymFlags::MERGED) { kind::ANYTHING } else { self.read_kinds(file, e, local) }
            }
            ExprKind::Unary { op, operand } => match op {
                UnOp::Not | UnOp::Delete => kind::BOOLEAN,
                UnOp::Typeof => kind::STRING,
                UnOp::Void => kind::UNDEFINED,
                UnOp::Plus => kind::NUMBER,
                UnOp::Minus | UnOp::BitNot | UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec => {
                    let operand = self.result_kinds_of(file, operand);
                    numeric(operand, operand)
                }
            },
            ExprKind::Binary { op, left, right } | ExprKind::Assign { op: Some(op), target: left, value: right } => match op {
                BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge | BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq | BinOp::In | BinOp::Instanceof => kind::BOOLEAN,
                BinOp::UShr => kind::NUMBER,
                BinOp::Comma => self.result_kinds_of(file, right),
                BinOp::And | BinOp::Or => self.result_kinds_of(file, left) | self.result_kinds_of(file, right),
                BinOp::Nullish => self.result_kinds_of(file, left) & !(kind::UNDEFINED | kind::NULL) | self.result_kinds_of(file, right),
                BinOp::Add => sum(self.result_kinds_of(file, left), self.result_kinds_of(file, right)),
                BinOp::Sub | BinOp::Mul | BinOp::Div | BinOp::Rem | BinOp::Pow | BinOp::Shl | BinOp::Shr | BinOp::BitAnd | BinOp::BitOr | BinOp::BitXor => {
                    numeric(self.result_kinds_of(file, left), self.result_kinds_of(file, right))
                }
            },
            ExprKind::Assign { op: None, value: expr, .. }
            | ExprKind::As { expr, .. }
            | ExprKind::Satisfies { expr, .. }
            | ExprKind::AsConst(expr)
            | ExprKind::NonNull(expr)
            | ExprKind::Instantiation { expr, .. } => self.result_kinds_of(file, expr),
            ExprKind::Cond { yes, no, .. } => self.result_kinds_of(file, yes) | self.result_kinds_of(file, no),
            ExprKind::Dot { name, chain: Chain::No, .. } if self.private_field_for_access(file, e, name).is_some() => {
                let id = self.private_field_for_access(file, e, name);
                self.symbol_kinds(Sym { file, id })
            }
            ExprKind::Dot { obj, name, chain: Chain::No, .. } if name == known::length => {
                match self.result_kinds_of(file, obj) {
                    kind::NOTHING => kind::NOTHING,
                    of if of & !(kind::ARRAY | kind::STRING) == 0 => kind::NUMBER,
                    _ => kind::ANYTHING,
                }
            }
            ExprKind::Call(call) => {
                let callee = hir[call].callee;
                if hir[call].chain != Chain::No {
                    return kind::ANYTHING;
                }
                match hir[callee].kind {
                    ExprKind::Ident(_) if self.refers_to_global_object(file, callee, b"String") => kind::STRING,
                    ExprKind::Ident(_) if self.refers_to_global_object(file, callee, b"Boolean") => kind::BOOLEAN,
                    ExprKind::Ident(_) if self.refers_to_global_object(file, callee, b"Number") => kind::NUMBER,
                    ExprKind::Ident(_) if self.refers_to_global_object(file, callee, b"Symbol") => kind::SYMBOL,
                    ExprKind::Dot { obj, name, chain: Chain::No, .. } if self.atoms().bytes(name) == b"for" && self.refers_to_global_object(file, obj, b"Symbol") => kind::SYMBOL,
                    ExprKind::Ident(_) if self.function_for_name_syntactically(file, callee).is_some() => match self.function_for_name_syntactically(file, callee) {
                        Some(func) => self.returned_kinds(file, func),
                        None => kind::ANYTHING,
                    },
                    ExprKind::Dot { obj, name, chain: Chain::No, .. } if MATH_FUNCTIONS.contains(&self.atoms().bytes(name)) && self.refers_to_global_object(file, obj, b"Math") => kind::NUMBER,
                    ExprKind::Dot { obj, name, chain: Chain::No, .. } => match self.result_kinds_of(file, obj) {
                        kind::NOTHING => kind::NOTHING,
                        kind::STRING => {
                            let first = hir.ids(hir[call].args).next();
                            self.kinds_returned_by_string_method(file, name, first)
                        }
                        _ => kind::ANYTHING,
                    },
                    _ => kind::ANYTHING,
                }
            }
            _ => kind::ANYTHING,
        }
    }

    fn kinds_returned_by_string_method(&mut self, file: FileId, name: Atom, first: Option<ExprId>) -> u16 {
        let is_plain = |c: &mut Self| match first {
            Some(first) => matches!(c.hir(file)[first].kind, ExprKind::Regex) || c.result_kinds_of(file, first) & !kind::STRING == 0,
            None => true,
        };
        match self.atoms().bytes(name) {
            b"charCodeAt" | b"indexOf" | b"lastIndexOf" | b"localeCompare" => kind::NUMBER,
            b"codePointAt" => kind::NUMBER | kind::UNDEFINED,
            b"at" => kind::STRING | kind::UNDEFINED,
            b"charAt" | b"concat" | b"normalize" | b"padEnd" | b"padStart" | b"repeat" | b"slice" | b"substr" | b"substring" | b"toLocaleLowerCase" | b"toLocaleUpperCase" | b"toLowerCase" | b"toString"
            | b"toUpperCase" | b"toWellFormed" | b"trim" | b"trimEnd" | b"trimLeft" | b"trimRight" | b"trimStart" | b"valueOf" => kind::STRING,
            b"endsWith" | b"includes" | b"isWellFormed" | b"startsWith" => kind::BOOLEAN,
            b"replace" | b"replaceAll" if is_plain(self) => kind::STRING,
            b"search" if is_plain(self) => kind::NUMBER,
            b"split" if is_plain(self) => kind::ARRAY,
            b"match" if is_plain(self) => kind::ARRAY | kind::NULL,
            _ => kind::ANYTHING,
        }
    }
}

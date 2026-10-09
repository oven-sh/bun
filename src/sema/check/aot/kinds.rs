//! What kind of value a variable holds, from what is stored to it and from nothing else.
//!
//! In a file whose types nothing holds the program to, JavaScript or a module of the runtime, a variable is kept so that it can hold anything,
//! and every operator asks what it has been handed: `i++` may be handed a bigint, `i & 1` an object. Most variables never hold but one
//! kind of value, and the text shows it: `let i = 0`, `i++`, `i < n`.
//!
//! A FACT. Compiled code relies on an answer without a test, so what is not shown to hold is not answered. No type of the checker is
//! gone by: not an annotation, not what is inferred for a call or for a property.
//!
//! An expression is gone through by its syntax. What an operator yields often does not depend on what it is handed: a comparison, `!a` and
//! `delete` yield a boolean, `typeof a` and a template a string, `+a` and `a >>> b` a number. `a - b` yields a number or a bigint, and a number
//! if one of the two is neither a bigint nor an object: the two kinds do not mix, it throws. `a + b` concatenates if either
//! is a string, and adds numbers if both are `undefined`, `null`, booleans or numbers.
//!
//! A name stands for what its variable holds, and `this.#name` for what the field does. Every store to a variable is in the file that declares it, from whatever function
//! (`integers.rs`, `Place`), so all of them are looked at. What is stored may depend on what the variable holds, `i++`, or another one
//! does: the least sets that all stores stay within. They are found for all variables of a file at once, from nothing upward, so an answer
//! does not depend on which variable is asked about first.
//!
//! Where a name is read, more may be known than what its variable holds over its whole life: `if (typeof n !== "number") throw ..`, and `n` is a number from there
//! on. From the read back over the flow nodes of the binder, to the stores that reach it, with the tests that have been passed on the way. Only for a variable of which
//! the flow tells every store: see `told_of_variable`.
//!
//! A function returns what its `return`s yield, whoever calls it. A call yields that where its callee is a name that stands for one function
//! of the file whenever it is read. The functions of a file are in the same fixed point as its variables.

use super::integers::Store;
use crate::atom::{Atom, known};
use crate::bind::{Decl, Flow, FlowId, FlowTarget, FnOwner, Parent, PatParent, SymFlags, SymbolId, UNREACHABLE};
use crate::check::Checker;
use crate::check::errors::Container;
use crate::check::errors_names_and_exports::root_declaration;
use crate::hir::{BinOp, Chain, ExprId, ExprKind, ExprTag, FileKind, Flags, FnBody, FnId, PatKind, StmtId, StmtKind, UnOp, VarKind};
use crate::program::{FileId, Sym};
use crate::util::{FxHashMap, FxHashSet};
use std::rc::Rc;

/// The kinds of values, a bit for each.
pub mod kind {
    pub const UNDEFINED: u16 = 1;
    pub const NULL: u16 = 1 << 1;
    pub const BOOLEAN: u16 = 1 << 2;
    pub const NUMBER: u16 = 1 << 3;
    pub const STRING: u16 = 1 << 4;
    pub const BIGINT: u16 = 1 << 5;
    pub const SYMBOL: u16 = 1 << 6;
    /// What `typeof` calls a function.
    pub const FUNCTION: u16 = 1 << 7;
    /// An array that an array literal has made.
    pub const ARRAY: u16 = 1 << 8;
    /// Any other object.
    pub const OBJECT: u16 = 1 << 9;
    pub const ANYTHING: u16 = PLAIN | BIGINT | SYMBOL | OBJECTS;
    pub const NOTHING: u16 = 0;
    /// What is converted to a number by itself, running no code and yielding no bigint.
    pub const PLAIN: u16 = UNDEFINED | NULL | BOOLEAN | NUMBER | STRING;
    pub const OBJECTS: u16 = FUNCTION | ARRAY | OBJECT;
}

#[derive(Default)]
pub(super) struct State {
    /// By file: what the variables, parameters and `#private` fields hold whose stores are followed.
    held: FxHashMap<FileId, Rc<FxHashMap<SymbolId, u16>>>,
    /// While that is found for a file: what has been found so far.
    growing: Option<(FileId, FxHashMap<SymbolId, u16>)>,
    /// By file: `kinds_returned_by`.
    returned: FxHashMap<FileId, Rc<FxHashMap<FnId, u16>>>,
    /// The same while `growing`.
    returned_so_far: FxHashMap<FnId, u16>,
    /// `kinds_yielded_by`, once the file is done.
    yielded: FxHashMap<(FileId, ExprId), u16>,
    /// The same while `growing`, for one round.
    yielded_this_round: FxHashMap<ExprId, u16>,
    /// `told_of_variable`, as far as it has been asked.
    told: FxHashMap<Sym, Option<Told>>,
    /// `kinds_asserted_by`, as far as it has been asked.
    asserted: FxHashMap<(FileId, FnId, u32), u16>,
    /// `is_tested`, by file.
    tested: FxHashMap<FileId, Rc<FxHashSet<SymbolId>>>,
    /// `kinds_at`, by variable and flow node, once the file is done.
    at_flow: FxHashMap<(Sym, FlowId), u16>,
    /// The same while `growing`, for one round.
    at_flow_this_round: FxHashMap<(SymbolId, FlowId), u16>,
    /// `is_used_as_number`, by file.
    used_as_numbers: FxHashMap<FileId, Rc<FxHashSet<SymbolId>>>,
}

/// How far control flow tells what a variable holds.
#[derive(Copy, Clone)]
struct Told {
    /// The code that declares it. Every store to it is part of that code.
    container: Container,
    /// Nothing is stored to it once it has its first value, and no read comes before that.
    is_constant: bool,
}

/// From the read of a variable back to the stores that reach it.
struct Walk {
    at: Sym,
    held: u16,
    is_constant: bool,
    /// It starts from what the variable holds, so what it finds at a flow node every read of the variable finds there.
    is_of_read: bool,
    /// By join of paths: what was found there.
    joins: FxHashMap<FlowId, u16>,
    steps: u32,
    /// How many functions that assert by calling one that does have been gone into.
    depth: u8,
}

const MOST_STEPS: u32 = 20_000;
const MOST_DEPTH: u8 = 3;
const NIL: u16 = kind::UNDEFINED | kind::NULL;

/// What `typeof` calls by the name, and what it calls by another. An object may pass itself off as `undefined`.
fn kinds_called(name: &[u8]) -> (u16, u16) {
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

const FUNCTIONS_OF_MATH: [&[u8]; 35] = [
    b"abs", b"acos", b"acosh", b"asin", b"asinh", b"atan", b"atan2", b"atanh", b"cbrt", b"ceil", b"clz32", b"cos", b"cosh", b"exp", b"expm1", b"floor", b"fround", b"hypot",
    b"imul", b"log", b"log10", b"log1p", b"log2", b"max", b"min", b"pow", b"random", b"round", b"sign", b"sin", b"sinh", b"sqrt", b"tan", b"tanh", b"trunc",
];

/// What an operator on numbers and bigints other than `+` yields.
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
        // A symbol throws.
        numeric(a, b)
    } else if a & (kind::BIGINT | kind::OBJECTS) == 0 || b & (kind::BIGINT | kind::OBJECTS) == 0 {
        // A bigint is added to a bigint alone.
        kind::NUMBER | kind::STRING
    } else {
        kind::NUMBER | kind::STRING | kind::BIGINT
    }
}

impl<'p, 's> Checker<'p, 's> {
    /// Every value that the variable or the parameter ever holds is of one of the kinds. `kind::ANYTHING`: nothing is known.
    pub fn kinds_held_by(&mut self, at: Sym) -> u16 {
        let found = match &self.aot.kinds.growing {
            Some((file, so_far)) if *file == at.file => so_far.get(&at.id).copied(),
            _ => self.kinds_held_in(at.file).get(&at.id).copied(),
        };
        match found {
            Some(found) => found,
            None => self.kinds_declared_for(at),
        }
    }

    fn kinds_held_in(&mut self, file: FileId) -> Rc<FxHashMap<SymbolId, u16>> {
        if let Some(known) = self.aot.kinds.held.get(&file) {
            return Rc::clone(known);
        }
        let mut followed = Vec::new();
        for id in (0..self.bound(file).symbols.len() as u32).map(SymbolId) {
            let is_variable = match self.bound(file).symbols[id.idx()].decls.first() {
                Some(Decl::Var(_)) => true,
                Some(Decl::Param(_) | Decl::Member(_)) => false,
                _ => continue,
            };
            let place = self.place_of_integers(Sym { file, id });
            if place.is_followed {
                // A variable is blank at first. Whether anything reads it by then is known.
                let starts_blank = place.starts_nil && (!is_variable || self.starts_undefined(self.files().sym(file, id)));
                followed.push((id, place, starts_blank));
            }
        }
        let functions: Vec<FnId> = (0..self.hir(file).fns.len() as u32).map(FnId).filter(|&func| !matches!(self.hir(file)[func].body, FnBody::None)).collect();
        // No name of another file is looked into, so one file is gone through at a time.
        let outer = self.aot.kinds.growing.replace((file, followed.iter().map(|it| (it.0, kind::NOTHING)).collect()));
        let outer_returned = std::mem::replace(&mut self.aot.kinds.returned_so_far, functions.iter().map(|&func| (func, kind::NOTHING)).collect());
        let outer_yielded = std::mem::take(&mut self.aot.kinds.yielded_this_round);
        let outer_at_flow = std::mem::take(&mut self.aot.kinds.at_flow_this_round);
        loop {
            let mut has_grown = false;
            self.aot.kinds.yielded_this_round.clear();
            self.aot.kinds.at_flow_this_round.clear();
            for &func in &functions {
                let all = self.find_kinds_returned_by(file, func);
                has_grown |= self.aot.kinds.returned_so_far.insert(func, all) != Some(all);
            }
            for (id, place, starts_blank) in &followed {
                let mut all = if *starts_blank { kind::UNDEFINED } else { kind::NOTHING };
                for &store in &place.stores {
                    all |= match store {
                        Store::Value(e) | Store::Computed(e) => self.kinds_yielded_by(file, e),
                        Store::Nil => kind::UNDEFINED,
                    };
                }
                if let Some((_, so_far)) = &mut self.aot.kinds.growing
                    && so_far.insert(*id, all) != Some(all)
                {
                    has_grown = true;
                }
            }
            if !has_grown {
                break;
            }
        }
        let held = Rc::new(std::mem::replace(&mut self.aot.kinds.growing, outer).map_or_else(Default::default, |it| it.1));
        self.aot.kinds.held.insert(file, Rc::clone(&held));
        self.aot.kinds.yielded_this_round = outer_yielded;
        self.aot.kinds.at_flow_this_round = outer_at_flow;
        let returned = std::mem::replace(&mut self.aot.kinds.returned_so_far, outer_returned);
        self.aot.kinds.returned.insert(file, Rc::new(returned));
        held
    }

    /// Whatever a call of the function yields is of one of the kinds, whoever calls it. Not what `new` makes of it.
    pub fn kinds_returned_by(&mut self, file: FileId, func: FnId) -> u16 {
        if matches!(&self.aot.kinds.growing, Some((growing, _)) if *growing == file) {
            return self.aot.kinds.returned_so_far.get(&func).copied().unwrap_or(kind::ANYTHING);
        }
        self.kinds_held_in(file);
        self.aot.kinds.returned.get(&file).and_then(|returned| returned.get(&func)).copied().unwrap_or(kind::ANYTHING)
    }

    fn find_kinds_returned_by(&mut self, file: FileId, func: FnId) -> u16 {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // The promise, the generator.
        if hir[func].flags.intersects(Flags::ASYNC | Flags::GENERATOR) {
            return kind::OBJECT;
        }
        if let FnBody::Expr(value) = hir[func].body {
            return self.kinds_yielded_by(file, value);
        }
        let mut all = if bound.fns[func.idx()].end == UNREACHABLE { kind::NOTHING } else { kind::UNDEFINED };
        for stmt in bound.ids(bound.fns[func.idx()].returns) {
            if let StmtKind::Return(value) = hir[stmt].kind {
                all |= if value.is_some() { self.kinds_yielded_by(file, value) } else { kind::UNDEFINED };
            }
        }
        all
    }

    /// The function of the file that the name `e` stands for whenever it is read: a function declaration that nothing is assigned to, or a
    /// `const` that a function expression initializes. In JavaScript a function in a block is a `var` besides, which holds `undefined` at first.
    fn function_named_by_text(&self, file: FileId, e: ExprId) -> Option<FnId> {
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

    /// Whether the variable or the parameter is used as a number, and nowhere as an object or a function. A PREDICTION, for one of which
    /// nothing else is known: `function f(n) { for (let i = 0; i < n; i++) .. }`.
    ///
    /// As a number: an operand of `<`, `<=`, `>`, `>=` whose other side is shown to be a number, or of an operator on numbers other than
    /// `+`, which also concatenates.
    pub(super) fn is_used_as_number(&mut self, at: Sym) -> bool {
        if let Some(known) = self.aot.kinds.used_as_numbers.get(&at.file) {
            return known.contains(&at.id);
        }
        let (file, hir, bound) = (at.file, self.hir(at.file), self.bound(at.file));
        let (mut as_numbers, mut otherwise): (FxHashSet<SymbolId>, FxHashSet<SymbolId>) = Default::default();
        for &e in self.exprs_by_kind_of(file).of(ExprTag::Ident) {
            let symbol = bound.expr_symbol[e.idx()];
            let Parent::Expr(parent) = bound.expr_parent[e.idx()] else { continue };
            if symbol.is_none() || parent.is_none() {
                continue;
            }
            match hir[parent].kind {
                ExprKind::Binary { op: BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge, left, right } => {
                    if self.kinds_yielded_by(file, if left == e { right } else { left }) == kind::NUMBER {
                        as_numbers.insert(symbol);
                    }
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
        as_numbers.retain(|symbol| !otherwise.contains(symbol));
        let is_used = as_numbers.contains(&at.id);
        self.aot.kinds.used_as_numbers.insert(file, Rc::new(as_numbers));
        is_used
    }

    /// Of a name whose stores are not followed one by one: a function declaration that nothing is assigned to. Not in JavaScript, where a
    /// function in a block is a `var` besides.
    fn kinds_declared_for(&mut self, at: Sym) -> u16 {
        let (hir, bound) = (self.hir(at.file), self.bound(at.file));
        let Some(symbol) = bound.symbols.get(at.id.idx()) else { return kind::ANYTHING };
        let is_more = SymFlags::VALUE.difference(SymFlags::FUNCTION) | SymFlags::MERGED | SymFlags::ASSIGNED | SymFlags::ALIAS;
        let is_function = !hir.is_js && !symbol.decls.is_empty() && symbol.decls.iter().all(|decl| matches!(decl, Decl::Fn(_)));
        if is_function && !symbol.flags.intersects(is_more) && bound.assignments_to(at.id).is_empty() && !self.has_direct_eval(at.file) { kind::FUNCTION } else { kind::ANYTHING }
    }

    /// `None`: code that the control flow does not tell of may store to the variable or the parameter at any time.
    fn told_of_variable(&mut self, at: Sym) -> Option<Told> {
        if let Some(&known) = self.aot.kinds.told.get(&at) {
            return known;
        }
        let found = self.find_told_of_variable(at);
        self.aot.kinds.told.insert(at, found);
        found
    }

    fn find_told_of_variable(&mut self, at: Sym) -> Option<Told> {
        let file = at.file;
        let (hir, bound) = (self.hir(file), self.bound(file));
        let symbol = bound.symbols.get(at.id.idx())?;
        if symbol.flags.intersects(SymFlags::MERGED | SymFlags::ALIAS) || self.is_stored_through_assertions(file, at.id) || self.has_direct_eval(file) {
            return None;
        }
        let [decl] = symbol.decls[..] else { return None };
        let (container, is_parameter) = match decl {
            Decl::Var(pat) | Decl::Require(pat) => {
                let PatParent::Var(d) = root_declaration(bound, pat) else { return None };
                let stmt = bound.var_stmt[d.idx()].some()?;
                (self.container_of_flow(file, bound.stmt_parent[stmt.idx()]), false)
            }
            Decl::Param(pat) => {
                let PatParent::Param(p) = root_declaration(bound, pat) else { return None };
                let func = bound.param_fn[p.idx()];
                // Through `arguments` a parameter can be stored to. A function that the body declares by the name takes its place.
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
            // What a script declares at its top level, every file sees.
            Container::File if self.files().module(file).is_module() => {}
            _ => return None,
        }
        let stores = bound.assignments_to(at.id);
        if stores.iter().any(|&(_, target)| self.container_of_flow(file, bound.expr_parent[target.idx()]) != container || self.runs_off_the_flow(file, target)) {
            return None;
        }
        let is_constant = stores.is_empty() && (is_parameter || !self.starts_undefined(self.files().sym(file, at.id)));
        Some(Told { container, is_constant })
    }

    /// Whether the name of the variable stands somewhere where `kinds_passing` and `kinds_entering` look at it. One pass over the names of a file.
    fn is_tested(&mut self, at: Sym) -> bool {
        if let Some(known) = self.aot.kinds.tested.get(&at.file) {
            return known.contains(&at.id);
        }
        let (file, hir, bound) = (at.file, self.hir(at.file), self.bound(at.file));
        let mut tested: FxHashSet<SymbolId> = FxHashSet::default();
        for &e in self.exprs_by_kind_of(file).of(ExprTag::Ident) {
            let symbol = bound.expr_symbol[e.idx()];
            if symbol.is_none() {
                continue;
            }
            let is_tested = match bound.expr_parent[e.idx()] {
                Parent::Expr(parent) if parent.is_some() => match hir[parent].kind {
                    ExprKind::Unary { op: UnOp::Typeof | UnOp::Not, .. } => true,
                    ExprKind::Binary { op, .. } => matches!(op, BinOp::EqEqEq | BinOp::NotEqEq | BinOp::EqEq | BinOp::NotEq | BinOp::Instanceof | BinOp::And | BinOp::Or),
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
        let is_tested = tested.contains(&at.id);
        self.aot.kinds.tested.insert(file, Rc::new(tested));
        is_tested
    }

    /// Whatever the name `e` yields where it stands is of one of the kinds: what its variable holds, less what the tests that have been passed and the stores on the way
    /// to `e` rule out.
    fn kinds_read_by(&mut self, file: FileId, e: ExprId, id: SymbolId) -> u16 {
        let at = Sym { file, id };
        let held = self.kinds_held_by(at);
        // Most variables are never tested, and hold what they hold wherever they are read.
        if held.count_ones() <= 1 || !self.is_tested(at) {
            return held;
        }
        let Some(told) = self.told_of_variable(at) else { return held };
        let bound = self.bound(file);
        let flow = bound.expr_flow[e.idx()];
        // Between a test or a store and the read, code that the control flow does not tell of may store to it.
        let is_read_elsewhere = told.container != self.container_of_flow(file, bound.expr_parent[e.idx()]);
        if is_read_elsewhere && !told.is_constant || flow.is_none() || flow == UNREACHABLE || self.runs_off_the_flow(file, e) {
            return held;
        }
        let mut walk = Walk { at, held, is_constant: told.is_constant, is_of_read: true, joins: FxHashMap::default(), steps: 0, depth: 0 };
        self.kinds_at(&mut walk, flow)
    }

    /// What the variable holds when control is at the flow node, on its way to the read.
    fn kinds_at(&mut self, walk: &mut Walk, start: FlowId) -> u16 {
        if !walk.is_of_read {
            return self.find_kinds_at(walk, start);
        }
        let is_growing = matches!(&self.aot.kinds.growing, Some((growing, _)) if *growing == walk.at.file);
        let known = if is_growing { self.aot.kinds.at_flow_this_round.get(&(walk.at.id, start)) } else { self.aot.kinds.at_flow.get(&(walk.at, start)) };
        if let Some(&known) = known {
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
            if walk.steps > MOST_STEPS || self.is_half_of_stack_in_use() {
                break walk.held;
            }
            match bound.flow[flow.idx()] {
                Flow::Unreachable => break kind::NOTHING,
                // What held of a variable that never changes where a function was made holds in the function.
                Flow::Start { outer, .. } | Flow::StartInvoked { outer, .. } => {
                    if !walk.is_constant || outer.is_none() || outer == UNREACHABLE {
                        break walk.held;
                    }
                    flow = outer;
                }
                Flow::Assign { before, target } => {
                    if self.is_store_to_place(walk.at, target) {
                        break self.kinds_stored_at(file, target) & walk.held;
                    }
                    flow = before;
                }
                Flow::Cond { before, expr, sense } => {
                    passing &= self.kinds_passing(file, expr, sense, walk.at.id);
                    flow = before;
                }
                Flow::Switch { before, stmt, from, to } => {
                    passing &= self.kinds_entering(file, stmt, from, to, walk.at.id);
                    flow = before;
                }
                Flow::Call { before, call } => {
                    passing &= self.kinds_passing_call(file, call, walk.at.id, walk.depth);
                    flow = before;
                }
                // After a `finally` block only some of the paths into the block count. All of them are taken.
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
                // The first edge is the way in.
                Flow::Loop { start, len } => match *bound.edges(start, len) {
                    [] => break kind::NOTHING,
                    [entry] => flow = entry,
                    [entry, ..] => {
                        if self.is_stored_to_in_loop(walk.at, flow) {
                            break walk.held;
                        }
                        flow = entry;
                    }
                },
            }
        };
        found & passing
    }

    /// What an assignment node for the variable stores.
    fn kinds_stored_at(&mut self, file: FileId, target: FlowTarget) -> u16 {
        let hir = self.hir(file);
        match target {
            // Not the variable of `for .. of`, which has no initializer.
            FlowTarget::Var(d) if hir[d].init.is_some() && matches!(hir[hir[d].pat].kind, PatKind::Ident(_)) => self.kinds_yielded_by(file, hir[d].init),
            FlowTarget::Var(_) | FlowTarget::Pat(_) => kind::ANYTHING,
            FlowTarget::Expr(e) => match self.store_to_target(file, e) {
                Some(Store::Value(stored) | Store::Computed(stored)) => self.kinds_yielded_by(file, stored),
                Some(Store::Nil) => kind::UNDEFINED,
                None => kind::ANYTHING,
            },
        }
    }

    /// The kind of a literal, of `undefined` and of `void 0`. `NOTHING`: it is none of them.
    fn kind_of_literal(&self, file: FileId, e: ExprId) -> u16 {
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

    /// Of which kinds the variable can be, `test` having turned out truthy, if `holds`, or falsy. `ANYTHING`: the test says nothing of it.
    fn kinds_passing(&mut self, file: FileId, test: ExprId, holds: bool, id: SymbolId) -> u16 {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let names_it = |e: ExprId| matches!(hir[e].kind, ExprKind::Ident(_)) && bound.expr_symbol[e.idx()] == id;
        // `a instanceof (a = C)`: what was tested is no longer what is held.
        if bound.assignments_to(id).iter().any(|&(_, target)| hir[target].pos >= hir[test].pos && hir[target].end <= hir[test].end) {
            return kind::ANYTHING;
        }
        match hir[test].kind {
            // No function, no array and no symbol is falsy.
            ExprKind::Ident(_) if names_it(test) => kind::ANYTHING & !(if holds { NIL } else { kind::SYMBOL | kind::FUNCTION | kind::ARRAY }),
            ExprKind::Unary { op: UnOp::Not, operand } => self.kinds_passing(file, operand, !holds, id),
            ExprKind::Binary { op: op @ (BinOp::EqEqEq | BinOp::NotEqEq | BinOp::EqEq | BinOp::NotEq), left, right } => {
                let is_equal = matches!(op, BinOp::EqEqEq | BinOp::EqEq) == holds;
                let is_strict = matches!(op, BinOp::EqEqEq | BinOp::NotEqEq);
                for (one, other) in [(left, right), (right, left)] {
                    if let (ExprKind::Unary { op: UnOp::Typeof, operand }, ExprKind::String(name)) = (hir[one].kind, hir[other].kind)
                        && names_it(operand)
                    {
                        let (called, otherwise) = kinds_called(self.atoms().bytes(name));
                        return if is_equal { called } else { otherwise };
                    }
                    let compared_with = self.kind_of_literal(file, other);
                    if !names_it(one) || compared_with == kind::NOTHING {
                        continue;
                    }
                    return match (compared_with & NIL != 0, is_strict, is_equal) {
                        (_, true, true) => compared_with,
                        (true, true, false) => kind::ANYTHING & !compared_with,
                        // So for both, and for an object that passes itself off as `undefined`.
                        (true, false, true) => NIL | kind::OBJECT,
                        (true, false, false) => kind::ANYTHING & !NIL,
                        _ => kind::ANYTHING,
                    };
                }
                kind::ANYTHING
            }
            ExprKind::Binary { op: BinOp::Instanceof, left, .. } if holds && names_it(left) => kind::OBJECTS,
            // None of their own functions can be replaced.
            ExprKind::Call(call) if hir[call].chain == Chain::No && hir.ids(hir[call].args).next().is_some_and(names_it) => {
                let ExprKind::Dot { obj, name, chain: Chain::No, .. } = hir[hir[call].callee].kind else { return kind::ANYTHING };
                match self.atoms().bytes(name) {
                    b"isInteger" | b"isSafeInteger" | b"isFinite" | b"isNaN" if holds && self.names_global_object(file, obj, b"Number") => kind::NUMBER,
                    // So for a proxy of an array as well.
                    b"isArray" if self.names_global_object(file, obj, b"Array") => kind::ANYTHING & if holds { kind::ARRAY | kind::OBJECT } else { !kind::ARRAY },
                    _ => kind::ANYTHING,
                }
            }
            _ => kind::ANYTHING,
        }
    }

    /// Of which kinds the variable can be, the call having returned: `validateString(name, "name")`, where the function throws unless it is handed a string.
    fn kinds_passing_call(&mut self, file: FileId, call: ExprId, id: SymbolId, depth: u8) -> u16 {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let ExprKind::Call(c) = hir[call].kind else { return kind::ANYTHING };
        let c = &hir[c];
        // `check(a, a = b)`: what was handed over is no longer what is held.
        let is_stored_to = bound.assignments_to(id).iter().any(|&(_, target)| hir[target].pos >= hir[call].pos && hir[target].end <= hir[call].end);
        if c.chain != Chain::No || is_stored_to || !matches!(hir[c.callee].kind, ExprKind::Ident(_)) {
            return kind::ANYTHING;
        }
        let Some(func) = self.function_named_by_text(file, c.callee) else { return kind::ANYTHING };
        let mut passing = kind::ANYTHING;
        for (index, argument) in hir.ids(c.args).enumerate() {
            match hir[argument].kind {
                ExprKind::Spread(_) => break,
                ExprKind::Ident(_) if bound.expr_symbol[argument.idx()] == id => passing &= self.kinds_asserted_by(file, func, index, depth),
                _ => {}
            }
        }
        passing
    }

    /// Of which kinds what is passed for the parameter of that number is, whenever a call of the function returns. `ANYTHING`: nothing is shown. By the text of the function alone.
    fn kinds_asserted_by(&mut self, file: FileId, func: FnId, index: usize, depth: u8) -> u16 {
        // What is found further in is cut off earlier.
        if depth > 0 {
            return self.find_kinds_asserted_by(file, func, index, depth);
        }
        if let Some(&known) = self.aot.kinds.asserted.get(&(file, func, index as u32)) {
            return known;
        }
        let found = self.find_kinds_asserted_by(file, func, index, depth);
        self.aot.kinds.asserted.insert((file, func, index as u32), found);
        found
    }

    fn find_kinds_asserted_by(&mut self, file: FileId, func: FnId, index: usize, depth: u8) -> u16 {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let f = &hir[func];
        // What an async function throws, whoever calls it does not see.
        if depth >= MOST_DEPTH || f.flags.intersects(Flags::ASYNC | Flags::GENERATOR) || !matches!(f.body, FnBody::Block(_)) {
            return kind::ANYTHING;
        }
        let Some(p) = f.params.iter().nth(index) else { return kind::ANYTHING };
        if hir[p].default.is_some() || hir[p].flags.contains(Flags::REST) || !matches!(hir[hir[p].pat].kind, PatKind::Ident(_)) {
            return kind::ANYTHING;
        }
        let at = Sym { file, id: bound.pat_symbol[hir[p].pat.idx()] };
        if at.id.is_none() || !self.told_of_variable(at).is_some_and(|told| told.is_constant) {
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
            let mut walk = Walk { at, held: kind::ANYTHING, is_constant: false, is_of_read: false, joins: FxHashMap::default(), steps: 0, depth: depth + 1 };
            all |= self.kinds_at(&mut walk, exit);
        }
        all
    }

    /// Of which kinds the variable can be, one of the clauses `from..to` of the `switch` statement having matched.
    fn kinds_entering(&mut self, file: FileId, stmt: StmtId, from: u16, to: u16, id: SymbolId) -> u16 {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let StmtKind::Switch { expr, cases } = hir[stmt].kind else { return kind::ANYTHING };
        let names_it = |e: ExprId| matches!(hir[e].kind, ExprKind::Ident(_)) && bound.expr_symbol[e.idx()] == id;
        let is_typeof = matches!(hir[expr].kind, ExprKind::Unary { op: UnOp::Typeof, operand } if names_it(operand));
        // No clauses: none has matched.
        if from >= to || !is_typeof && !names_it(expr) {
            return kind::ANYTHING;
        }
        let mut all = kind::NOTHING;
        for case in cases.iter().skip(from as usize).take((to - from) as usize) {
            let test = hir[case].test;
            all |= match test.some().map(|test| hir[test].kind) {
                Some(ExprKind::String(name)) if is_typeof => kinds_called(self.atoms().bytes(name)).0,
                Some(_) if !is_typeof && self.kind_of_literal(file, test) != kind::NOTHING => self.kind_of_literal(file, test),
                // `default`, or a test that is not looked into.
                _ => return kind::ANYTHING,
            };
        }
        all
    }

    /// Whatever the expression yields is of one of the kinds. For `a++` and `a--`: what is stored.
    pub fn kinds_yielded_by(&mut self, file: FileId, e: ExprId) -> u16 {
        // In the last round nothing grows, so what is remembered there is what is found there.
        if matches!(&self.aot.kinds.growing, Some((growing, _)) if *growing == file) {
            if let Some(&known) = self.aot.kinds.yielded_this_round.get(&e) {
                return known;
            }
            let found = self.find_kinds_yielded_by(file, e);
            self.aot.kinds.yielded_this_round.insert(e, found);
            return found;
        }
        if self.aot.kinds.growing.is_some() {
            return self.find_kinds_yielded_by(file, e);
        }
        if let Some(&known) = self.aot.kinds.yielded.get(&(file, e)) {
            return known;
        }
        let found = self.find_kinds_yielded_by(file, e);
        self.aot.kinds.yielded.insert((file, e), found);
        found
    }

    fn find_kinds_yielded_by(&mut self, file: FileId, e: ExprId) -> u16 {
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
                    // Nothing can be stored to these three of the global object.
                    return match self.atoms().bytes(name) {
                        _ if name == known::undefined => kind::UNDEFINED,
                        b"NaN" | b"Infinity" => kind::NUMBER,
                        _ => kind::ANYTHING,
                    };
                }
                let flags = self.bound(file).symbols[local.idx()].flags;
                if flags.intersects(SymFlags::ALIAS | SymFlags::MERGED) { kind::ANYTHING } else { self.kinds_read_by(file, e, local) }
            }
            ExprKind::Unary { op, operand } => match op {
                UnOp::Not | UnOp::Delete => kind::BOOLEAN,
                UnOp::Typeof => kind::STRING,
                UnOp::Void => kind::UNDEFINED,
                UnOp::Plus => kind::NUMBER,
                UnOp::Minus | UnOp::BitNot | UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec => {
                    let operand = self.kinds_yielded_by(file, operand);
                    numeric(operand, operand)
                }
            },
            ExprKind::Binary { op, left, right } | ExprKind::Assign { op: Some(op), target: left, value: right } => match op {
                BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge | BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq | BinOp::In | BinOp::Instanceof => kind::BOOLEAN,
                BinOp::UShr => kind::NUMBER,
                BinOp::Comma => self.kinds_yielded_by(file, right),
                BinOp::And | BinOp::Or => self.kinds_yielded_by(file, left) | self.kinds_yielded_by(file, right),
                BinOp::Nullish => self.kinds_yielded_by(file, left) & !(kind::UNDEFINED | kind::NULL) | self.kinds_yielded_by(file, right),
                BinOp::Add => sum(self.kinds_yielded_by(file, left), self.kinds_yielded_by(file, right)),
                BinOp::Sub | BinOp::Mul | BinOp::Div | BinOp::Rem | BinOp::Pow | BinOp::Shl | BinOp::Shr | BinOp::BitAnd | BinOp::BitOr | BinOp::BitXor => {
                    numeric(self.kinds_yielded_by(file, left), self.kinds_yielded_by(file, right))
                }
            },
            ExprKind::Assign { op: None, value: expr, .. }
            | ExprKind::As { expr, .. }
            | ExprKind::Satisfies { expr, .. }
            | ExprKind::AsConst(expr)
            | ExprKind::NonNull(expr)
            | ExprKind::Instantiation { expr, .. } => self.kinds_yielded_by(file, expr),
            ExprKind::Cond { yes, no, .. } => self.kinds_yielded_by(file, yes) | self.kinds_yielded_by(file, no),
            // Every store to a `#private` field is in the body of its class.
            ExprKind::Dot { name, chain: Chain::No, .. } if self.private_field_named_by(file, e, name).is_some() => {
                let id = self.private_field_named_by(file, e, name);
                self.kinds_held_by(Sym { file, id })
            }
            // Their own property, which nothing can be put in the place of.
            ExprKind::Dot { obj, name, chain: Chain::No, .. } if name == known::length => {
                let of = self.kinds_yielded_by(file, obj);
                if of != kind::NOTHING && of & !(kind::ARRAY | kind::STRING) == 0 { kind::NUMBER } else { kind::ANYTHING }
            }
            ExprKind::Call(call) => {
                let callee = hir[call].callee;
                if hir[call].chain != Chain::No {
                    return kind::ANYTHING;
                }
                match hir[callee].kind {
                    ExprKind::Ident(_) if self.names_global_object(file, callee, b"String") => kind::STRING,
                    ExprKind::Ident(_) if self.names_global_object(file, callee, b"Boolean") => kind::BOOLEAN,
                    ExprKind::Ident(_) if self.names_global_object(file, callee, b"Number") => kind::NUMBER,
                    ExprKind::Ident(_) if self.function_named_by_text(file, callee).is_some() => match self.function_named_by_text(file, callee) {
                        Some(func) => self.kinds_returned_by(file, func),
                        None => kind::ANYTHING,
                    },
                    // A function may be added to `Math`. None of its own can be replaced.
                    ExprKind::Dot { obj, name, chain: Chain::No, .. } if FUNCTIONS_OF_MATH.contains(&self.atoms().bytes(name)) && self.names_global_object(file, obj, b"Math") => kind::NUMBER,
                    ExprKind::Dot { obj, name, chain: Chain::No, .. } if self.kinds_yielded_by(file, obj) == kind::STRING => {
                        let first = hir.ids(hir[call].args).next();
                        self.kinds_yielded_by_method_of_string(file, name, first)
                    }
                    _ => kind::ANYTHING,
                }
            }
            _ => kind::ANYTHING,
        }
    }

    /// `s.name(first, ..)`, where `s` is a string: it has no properties of its own, and nothing can be put in the place of a function of `String.prototype`.
    fn kinds_yielded_by_method_of_string(&mut self, file: FileId, name: Atom, first: Option<ExprId>) -> u16 {
        // Handed an object, these hand over to a method of it, which yields what it likes. That of a regular expression is the engine's.
        let is_plain = |c: &mut Self| match first {
            Some(first) => matches!(c.hir(file)[first].kind, ExprKind::Regex) || c.kinds_yielded_by(file, first) == kind::STRING,
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

    /// Counts, for the variables, the parameters and the loops of the files of the program.
    pub fn explain_kinds(&mut self) -> Vec<String> {
        const NAMES: [&str; 10] = ["undefined", "null", "boolean", "number", "string", "bigint", "symbol", "function", "array", "object"];
        let describe = |kinds: u16| -> String {
            match kinds {
                kind::ANYTHING => "anything".to_owned(),
                kind::NOTHING => "nothing is ever stored".to_owned(),
                kinds => NAMES.iter().enumerate().filter(|&(bit, _)| kinds >> bit & 1 != 0).map(|(_, name)| *name).collect::<Vec<_>>().join(" | "),
            }
        };
        let mut files = 0;
        let (mut variables, mut parameters): (FxHashMap<u16, u32>, FxHashMap<u16, u32>) = Default::default();
        // By what the checker takes the variable for: how many there are, and how many of them hold that and nothing else.
        let mut claimed = [("number", kind::NUMBER, 0u32, 0u32), ("string", kind::STRING, 0, 0), ("boolean", kind::BOOLEAN, 0, 0)];
        let mut causes: FxHashMap<&'static str, u32> = FxHashMap::default();
        let (mut loops, mut counters, mut counters_known) = (0, 0, 0);
        let mut ranges = [("within int32", 0u32), ("within uint32", 0), ("wider, exact in a double", 0), ("no range", 0)];
        let mut unknown_counters = Vec::new();
        for file in (0..self.files().modules.len() as u32).map(FileId) {
            if !self.is_compiled(file) || matches!(self.hir(file).kind, FileKind::Declaration | FileKind::Json) {
                continue;
            }
            files += 1;
            let (hir, bound) = (self.hir(file), self.bound(file));
            for (id, symbol) in bound.symbols.iter().enumerate() {
                let at = Sym { file, id: SymbolId(id as u32) };
                let is_variable = match symbol.decls.first() {
                    Some(&Decl::Var(_)) => true,
                    Some(&Decl::Param(_)) => false,
                    _ => continue,
                };
                let kinds = self.kinds_held_by(at);
                *(if is_variable { &mut variables } else { &mut parameters }).entry(kinds).or_default() += 1;
                if !is_variable {
                    continue;
                }
                let ty = self.type_of_symbol(self.files().sym(file, at.id));
                for (_, of, all, confirmed) in &mut claimed {
                    let is_claimed = !ty.is_never()
                        && self.every_type(ty, |c, part| match *of {
                            kind::NUMBER => c.is_number_like(part),
                            kind::STRING => c.is_string_like(part),
                            _ => c.is_boolean_like(part),
                        });
                    *all += u32::from(is_claimed);
                    *confirmed += u32::from(is_claimed && kinds == *of);
                }
                if kinds != kind::ANYTHING {
                    continue;
                }
                let place = self.place_of_integers(at);
                let cause = if !place.is_followed {
                    match symbol.decls.first() {
                        Some(&Decl::Var(pat)) if !matches!(bound.pat_parent[pat.idx()], PatParent::Var(_)) => "not followed: out of a pattern",
                        Some(&Decl::Var(pat)) => match bound.pat_parent[pat.idx()] {
                            PatParent::Var(d) if bound.var_stmt[d.idx()].some().is_none_or(|stmt| !matches!(hir[stmt].kind, StmtKind::Var(_))) => "not followed: of a `catch` clause",
                            PatParent::Var(d) if hir[d].init.is_none() && bound.var_stmt[d.idx()].some().is_some_and(|stmt| matches!(bound.stmt_parent[stmt.idx()], Parent::Stmt(head) if head.is_some() && matches!(hir[head].kind, StmtKind::ForIn { .. } | StmtKind::ForOf { .. }))) => "not followed: of `for .. of` or `for .. in`",
                            _ => "not followed: assigned in a pattern, exported, or seen by other files",
                        },
                        _ => "not followed",
                    }
                } else {
                    let culprit = place.stores.iter().find_map(|&store| match store {
                        Store::Value(e) | Store::Computed(e) if self.kinds_yielded_by(file, e) == kind::ANYTHING => Some(e),
                        _ => None,
                    });
                    match culprit.map(|mut e| {
                        while let ExprKind::As { expr, .. } | ExprKind::NonNull(expr) | ExprKind::Satisfies { expr, .. } = hir[e].kind {
                            e = expr;
                        }
                        hir[e].kind
                    }) {
                        Some(ExprKind::Call(_)) => "a call",
                        Some(ExprKind::Dot { .. }) => "a property",
                        Some(ExprKind::Index { .. }) => "an element",
                        Some(ExprKind::Ident(_)) => "another name: a parameter, an import, a global, a variable that holds anything",
                        Some(ExprKind::Await(_) | ExprKind::Yield { .. }) => "`await` or `yield`",
                        Some(ExprKind::This) => "`this`",
                        Some(ExprKind::Binary { .. } | ExprKind::Cond { .. } | ExprKind::Assign { .. }) => "`a || b`, `a ? b : c` and the like with one of those",
                        Some(_) => "something else",
                        None => "several kinds that add up",
                    }
                };
                *causes.entry(cause).or_default() += 1;
            }
            for stmt in hir.stmts.iter() {
                let StmtKind::For { init, update, .. } = stmt.kind else { continue };
                loops += 1;
                if init.is_none() || update.is_none() {
                    continue;
                }
                let StmtKind::Var(declarations) = hir[init].kind else { continue };
                for d in declarations.iter() {
                    let id = bound.pat_symbol[hir[d].pat.idx()];
                    if id.is_none() || hir[d].kind == VarKind::Const || bound.assignments_to(id).is_empty() {
                        continue;
                    }
                    counters += 1;
                    let at = Sym { file, id };
                    let kinds = self.kinds_held_by(at);
                    if kinds == kind::NUMBER {
                        counters_known += 1;
                        let range = match self.integers_of_symbol(at) {
                            Some((least, most)) if least >= i64::from(i32::MIN) && most <= i64::from(i32::MAX) => 0,
                            Some((least, most)) if least >= 0 && most <= i64::from(u32::MAX) => 1,
                            Some(_) => 2,
                            None => 3,
                        };
                        ranges[range].1 += 1;
                    } else if unknown_counters.len() < 30 {
                        unknown_counters.push(format!("aot: kinds: a counter that is not known to be a number: {} at {}: {}", String::from_utf8_lossy(self.atoms().bytes(bound.symbols[id.idx()].name)), self.line_for_people(file, hir[d].loc.pos), describe(kinds)));
                    }
                }
            }
        }
        let mut lines = vec![format!("aot: kinds: {files} files, {} variables, {} parameters", variables.values().sum::<u32>(), parameters.values().sum::<u32>())];
        lines.push(format!("aot: kinds: {loops} `for` loops; they declare {counters} variables that are stored to; {counters_known} of those hold numbers and nothing else: {}", ranges.map(|(what, count)| format!("{count} {what}")).join(", ")));
        for (what, _, all, confirmed) in claimed {
            lines.push(format!("aot: kinds: the checker takes {all} variables for a {what}; the stores show that of {confirmed}"));
        }
        for (what, counts) in [("variables", variables), ("parameters", parameters)] {
            let mut counts: Vec<(u16, u32)> = counts.into_iter().collect();
            counts.sort_unstable_by_key(|&(kinds, count)| (std::cmp::Reverse(count), kinds));
            lines.extend(counts.into_iter().map(|(kinds, count)| format!("aot: kinds: {count} {what}: {}", describe(kinds))));
        }
        let mut causes: Vec<(&str, u32)> = causes.into_iter().collect();
        causes.sort_unstable_by_key(|&(what, count)| (std::cmp::Reverse(count), what));
        lines.extend(causes.into_iter().map(|(what, count)| format!("aot: kinds: {count} variables hold anything because of: {what}")));
        lines.append(&mut unknown_counters);
        lines
    }
}

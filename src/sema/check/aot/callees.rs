//! Callee resolution: the one function of the program whose closures a variable or a field holds.
//!
//! `scanner.getTokenStart()` reads a field and calls what it finds, and `visit(node)` does the same with a variable of the function around
//! it. Nearly always one function expression or declaration is all that the program ever stores there. Who knows it calls it directly, and
//! inlines it.
//!
//! **A variable** is stored to by name alone, in the text of the module that declares it: an import is read-only, and so is a module
//! namespace object. So every store is seen here, and what comes of them is a FACT.
//!
//! **A field** is stored to where an object is allocated and through every supertype. Those stores are noted while the program is translated
//! (`Checker::note_callee_stored`) and joined over the subtype sets when it is linked (`Subtypes::finish`). An untyped store (`(o as any).f =
//! g`, `o[key] = g`, `Object.assign`) is not among them, so what comes of them is a PREDICTION: the call tests for it.

use super::flows::Place;
use crate::bind::{Decl, FnOwner, Parent, PatParent, SymFlags, UNREACHABLE};
use crate::check::Checker;
use crate::check::errors_names_and_exports::root_declaration;
use crate::atom::Atom;
use crate::hir::{BinOp, Chain, ExprId, ExprKind, FileKind, Flags, FnBody, FnId, FnKind, PatKind, PropKey, PropKind, StmtId, StmtKind, UnOp, VarKind};
use crate::program::{FileId, Sym};
use crate::util::FxHashMap;

/// An expression that is nested more deeply than this in operators that hand on an operand is not seen through.
const DEEPEST_OPERAND: u32 = 16;

/// The functions whose closures get to a place. A join semilattice: `Nothing` below `One` below `Several` below `Unknown`. What is kept for
/// the sake of an explanation is the least of its kind, so that the order of the joins does not show.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
pub enum Callee {
    /// No function: nothing is stored, or `undefined` and `null` alone.
    #[default]
    Nothing,
    One(FileId, FnId),
    /// More than one: the two least, by file and number.
    Several((FileId, FnId), (FileId, FnId)),
    /// A value that is not seen through: the first in the program.
    Unknown(Place),
}

impl Callee {
    pub fn join(self, other: Callee) -> Callee {
        match (self, other) {
            (Callee::Nothing, found) | (found, Callee::Nothing) => found,
            (one, same) if one == same => one,
            (Callee::Unknown(at), Callee::Unknown(also_at)) => Callee::Unknown(at.min(also_at)),
            (unknown @ Callee::Unknown(_), _) | (_, unknown @ Callee::Unknown(_)) => unknown,
            _ => {
                let mut functions: Vec<(FileId, FnId)> = self.functions().chain(other.functions()).collect();
                functions.sort_unstable();
                functions.dedup();
                match functions[..] {
                    [] => Callee::Nothing,
                    [(file, func)] => Callee::One(file, func),
                    [first, second, ..] => Callee::Several(first, second),
                }
            }
        }
    }

    fn functions(self) -> impl Iterator<Item = (FileId, FnId)> {
        let (first, second) = match self {
            Callee::One(file, func) => (Some((file, func)), None),
            Callee::Several(first, second) => (Some(first), Some(second)),
            Callee::Nothing | Callee::Unknown(_) => (None, None),
        };
        first.into_iter().chain(second)
    }
}

/// Why a variable has no `OnlyFunction`.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Hole {
    /// It is no variable that one declaration of a module of the program gives a name of its own: a parameter, a name in a pattern, a merged
    /// or ambient declaration, what a script, a declaration file or a namespace declares, the variable of a loop.
    Declaration,
    /// It is stored to otherwise than as `name = value`: by a pattern, a loop, `++`, `+=`, `(name as T) = value`.
    Store(Place),
    /// What the stores put there is not closures of one function.
    Stored(Callee),
    /// It is stored to itself by way of another variable.
    Cycle,
}

/// See `Checker::only_function_of_variable`.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct OnlyFunction {
    pub file: FileId,
    pub func: FnId,
    /// A read may also find `undefined` or `null`: one of the stores puts it there, or a read may come before the first store.
    pub may_be_nil: bool,
    /// Which FUNCTION is known, not which closure. `let g; function outer(y) { const made = () => y; if (!g) g = made; const f = g!; f() }`: `f` holds a
    /// closure that another call of `outer` has made. This is the outermost of the variables that the closures have come by, `g` here,
    /// and the variable itself if every store to it makes the closure. All closures that get to the variable are made within one
    /// activation of the scope that binds this one, so what the function captures from there or from further out is the same for all.
    pub outermost: Sym,
    /// One of the stores is only expected to put a closure of the function there: what a call yields. Then nothing is a fact.
    pub is_predicted: bool,
}

/// What `Checker::callee_yielded_by` finds.
#[derive(Copy, Clone)]
pub(super) struct Yielded {
    pub callee: Callee,
    pub may_be_nil: bool,
    pub is_predicted: bool,
}

impl Yielded {
    fn of(callee: Callee, may_be_nil: bool) -> Yielded {
        Yielded { callee, may_be_nil, is_predicted: false }
    }

    fn join(self, other: Yielded) -> Yielded {
        Yielded { callee: self.callee.join(other.callee), may_be_nil: self.may_be_nil || other.may_be_nil, is_predicted: self.is_predicted || other.is_predicted }
    }
}

#[derive(Default)]
pub(super) struct State {
    of_variables: FxHashMap<Sym, Result<OnlyFunction, Hole>>,
    /// While the stores to a variable are gone through: `OnlyFunction::outermost` of the variables that they name.
    came_by: Option<Vec<Sym>>,
    /// `parameter_handed_back_by`, as far as it has been asked.
    handed_back: FxHashMap<(FileId, FnId), Option<u32>>,
}

impl<'p, 's> Checker<'p, 's> {
    /// `sym`: a variable or a function declaration. The function that every function it ever holds is a closure of. Each of those closures
    /// is made where the store is, or is what a name stands for there. So its environment is the one that is in scope at the store: if that
    /// has the layout of the environment that holds the variable, it is that very environment.
    ///
    /// It goes by the trees and the symbols alone: every task finds the same.
    pub fn only_function_of_variable(&mut self, sym: Sym) -> Option<OnlyFunction> {
        self.callee_of_variable(sym).ok()
    }

    /// The same, or why there is none.
    pub(super) fn callee_of_variable(&mut self, sym: Sym) -> Result<OnlyFunction, Hole> {
        if let Some(&known) = self.aot.callees.of_variables.get(&sym) {
            return known;
        }
        // One that is stored to itself by way of another has none, whichever of them is asked about first.
        self.aot.callees.of_variables.insert(sym, Err(Hole::Cycle));
        let around = self.aot.callees.came_by.replace(Vec::new());
        let found = self.find_callee_of_variable(sym);
        let came_by = std::mem::replace(&mut self.aot.callees.came_by, around).unwrap_or_default();
        let found = found.map(|only| {
            let mut outermost = (self.scopes_around(sym), sym);
            for other in came_by {
                let scopes = self.scopes_around(other);
                if scopes < outermost.0 {
                    outermost = (scopes, other);
                }
            }
            OnlyFunction { outermost: outermost.1, ..only }
        });
        self.aot.callees.of_variables.insert(sym, found);
        found
    }

    /// How many scopes are around what binds the variable, that one too. Of two variables that one piece of code sees, the one with fewer is
    /// the outer one. What another module declares is at its top level.
    fn scopes_around(&self, sym: Sym) -> u32 {
        let Some((file, decl)) = self.files().value_declaration(sym) else { return 0 };
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut scope = bound.scope_of_declaration(hir, decl);
        // A `var` is a variable of the function, or of the module, wherever it is declared.
        if let Decl::Var(pat) = decl
            && let PatParent::Var(d) = root_declaration(bound, pat)
            && hir[d].kind == VarKind::Var
            && scope.is_some()
        {
            scope = bound.container_scope(scope);
        }
        let mut scopes = 0;
        while scope.is_some() {
            scopes += 1;
            scope = bound.scopes[scope.idx()].parent;
        }
        scopes
    }

    /// `export default <expression>`, if that is what declares the symbol: the file and the expression.
    fn expression_exported_as(&self, sym: Sym) -> Option<(FileId, ExprId)> {
        self.files().decls(sym).into_iter().find_map(|(file, decl)| match decl {
            Decl::ExportExpr(stmt) => match self.hir(file)[stmt].kind {
                StmtKind::ExportDefault(value) | StmtKind::ExportAssign(value) => Some((file, value)),
                _ => None,
            },
            _ => None,
        })
    }

    fn find_callee_of_variable(&mut self, sym: Sym) -> Result<OnlyFunction, Hole> {
        // `export default EventEmitter as any`, by way of an import. Nothing else is ever bound to it. It is left a prediction.
        if let Some((file, value)) = self.expression_exported_as(sym) {
            let exported = self.callee_yielded_by(file, value, 0);
            let Callee::One(file, func) = exported.callee else { return Err(Hole::Stored(exported.callee)) };
            return Ok(OnlyFunction { file, func, may_be_nil: exported.may_be_nil, outermost: sym, is_predicted: true });
        }
        let (file, decl) = self.files().value_declaration(sym).ok_or(Hole::Declaration)?;
        let (hir, bound) = (self.hir(file), self.bound(file));
        // What a declaration file declares, other code stores to. What a script declares, the other scripts see.
        if hir.kind == FileKind::Declaration || !self.files().module(file).is_module() {
            return Err(Hole::Declaration);
        }
        let local = bound.symbol_of_declaration(decl);
        let symbol = bound.symbols.get(local.idx()).ok_or(Hole::Declaration)?;
        if symbol.flags.contains(SymFlags::MERGED) {
            return Err(Hole::Declaration);
        }
        let (declared_by, mut stored) = match decl {
            Decl::Var(pat) => {
                let PatParent::Var(d) = root_declaration(bound, pat) else { return Err(Hole::Declaration) };
                if symbol.decls.iter().filter(|&&decl| !self.declares_only_a_type(sym, decl)).count() != 1 || hir[d].flags.contains(Flags::AMBIENT) {
                    return Err(Hole::Declaration);
                }
                let first = if hir[d].pat != pat {
                    // `const { Stream } = legacy`: what the literal has by the name, which may have been replaced since.
                    let PatParent::Prop(outer, prop) = bound.pat_parent[pat.idx()] else { return Err(Hole::Declaration) };
                    let name = match (hir[prop].key, hir[pat].kind) {
                        _ if outer != hir[d].pat || hir[prop].is_rest || hir[prop].default.is_some() || hir[d].init.is_none() => return Err(Hole::Declaration),
                        (PropKey::Name(name), _) | (PropKey::None, PatKind::Ident(name)) => name,
                        _ => return Err(Hole::Declaration),
                    };
                    Yielded { is_predicted: true, ..Yielded::of(self.callee_in_literal_held_by(file, hir[d].init, name, 0), false) }
                } else if hir[d].init.is_some() {
                    self.callee_yielded_by(file, hir[d].init, 0)
                } else {
                    Yielded::of(Callee::Nothing, false)
                };
                (bound.var_stmt[d.idx()], first)
            }
            // Overloads are declarations without a body.
            Decl::Fn(_) => {
                let mut with_body = None;
                for decl in symbol.decls.iter() {
                    let func = match *decl {
                        Decl::Fn(func) => func,
                        _ if self.declares_only_a_type(sym, *decl) => continue,
                        _ => return Err(Hole::Declaration),
                    };
                    if !matches!(hir[func].body, FnBody::None) && with_body.replace(func).is_some() {
                        return Err(Hole::Declaration);
                    }
                }
                let func = with_body.ok_or(Hole::Declaration)?;
                let FnOwner::Stmt(stmt) = bound.fns[func.idx()].owner else { return Err(Hole::Declaration) };
                (stmt, Yielded::of(Callee::One(file, func), false))
            }
            _ => return Err(Hole::Declaration),
        };
        if declared_by.is_none() || self.is_stored_to_otherwise(file, declared_by, bound.modifier_flags(hir, decl).contains(Flags::EXPORT)) {
            return Err(Hole::Declaration);
        }
        if self.is_stored_through_casts(file, local) {
            return Err(Hole::Store(Place { file, pos: hir[declared_by].start }));
        }
        for &(_, target) in bound.assignments_to(local) {
            let otherwise = Err(Hole::Store(Place { file, pos: hir[target].pos }));
            let Parent::Expr(parent) = bound.expr_parent[target.idx()] else { return otherwise };
            let ExprKind::Assign { op: None | Some(BinOp::And | BinOp::Or | BinOp::Nullish), target: to, value } = hir[parent].kind else { return otherwise };
            if to != target {
                return otherwise;
            }
            stored = stored.join(self.callee_yielded_by(file, value, 0));
        }
        let Callee::One(file, func) = stored.callee else { return Err(Hole::Stored(stored.callee)) };
        Ok(OnlyFunction { file, func, may_be_nil: stored.may_be_nil || self.starts_undefined(sym), outermost: sym, is_predicted: stored.is_predicted })
    }

    /// The parameter, by its number, that every call of the function hands back: `function setTextRange<T extends TextRange>(range: T, location) { return
    /// location ? setTextRangePosEnd(range, location.pos, location.end) : range }`. Every `return` yields it, by its name or through a call of
    /// a function that hands it back in turn, or does not return (`never`), and the end of the body is not reached. Nothing is stored to it, and it has no
    /// initializer. A FACT: it goes by the trees and the symbols alone, and every task finds the same.
    pub fn parameter_handed_back_by(&mut self, file: FileId, func: FnId) -> Option<u32> {
        if let Some(&known) = self.aot.callees.handed_back.get(&(file, func)) {
            return known;
        }
        // One that only hands back what it hands back itself never returns.
        self.aot.callees.handed_back.insert((file, func), None);
        let found = self.find_parameter_handed_back_by(file, func);
        self.aot.callees.handed_back.insert((file, func), found);
        found
    }

    fn find_parameter_handed_back_by(&mut self, file: FileId, func: FnId) -> Option<u32> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if hir[func].flags.intersects(Flags::ASYNC | Flags::GENERATOR) || !matches!(hir[func].kind, FnKind::Decl | FnKind::Expr | FnKind::Arrow) {
            return None;
        }
        let returned: Vec<ExprId> = match hir[func].body {
            FnBody::None => return None,
            FnBody::Expr(body) => vec![body],
            FnBody::Block(_) => {
                let end = bound.fns[func.idx()].end;
                if end.is_some() && end != UNREACHABLE && self.is_reachable(file, end) {
                    return None;
                }
                bound.ids(bound.fns[func.idx()].returns).map(|stmt: StmtId| if let StmtKind::Return(value) = hir[stmt].kind { value } else { ExprId::NONE }).collect()
            }
        };
        let mut handed_back = None;
        for value in returned {
            // `return Debug.fail(..)` does not return.
            if value.is_some() && self.type_of_expr(file, value).is_never() {
                continue;
            }
            let parameter = if value.is_some() { self.parameter_yielded_by(file, func, value, 0)? } else { return None };
            if handed_back.replace(parameter).is_some_and(|other| other != parameter) {
                return None;
            }
        }
        handed_back
    }

    /// `e`: an expression in the body of `func`. The parameter of `func` that is its value, whenever it has one.
    fn parameter_yielded_by(&mut self, file: FileId, func: FnId, e: ExprId, depth: u32) -> Option<u32> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if depth > DEEPEST_OPERAND {
            return None;
        }
        match hir[e].kind {
            // `as` may make another object of plain data.
            ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) => self.parameter_yielded_by(file, func, expr, depth + 1),
            ExprKind::Binary { op: BinOp::Comma, right, .. } => self.parameter_yielded_by(file, func, right, depth + 1),
            ExprKind::Cond { yes, no, .. } => {
                let yes = self.parameter_yielded_by(file, func, yes, depth + 1)?;
                (self.parameter_yielded_by(file, func, no, depth + 1)? == yes).then_some(yes)
            }
            ExprKind::Ident(name) => {
                let sym = self.symbol_of_identifier(file, e, name)?;
                let (declared_in, Decl::Param(pat)) = self.files().value_declaration(sym)? else { return None };
                let PatParent::Param(parameter) = bound.pat_parent[pat.idx()] else { return None };
                if declared_in != file || bound.param_fn[parameter.idx()] != func || !matches!(hir[pat].kind, PatKind::Ident(_)) {
                    return None;
                }
                let is_plain = hir[parameter].default.is_none() && !hir[parameter].flags.contains(Flags::REST) && bound.assignments_to(bound.symbol_of_declaration(Decl::Param(pat))).is_empty();
                let number = hir[func].params.iter().position(|other| other == parameter)?;
                is_plain.then_some(number as u32)
            }
            ExprKind::Call(_) => {
                let argument = self.argument_handed_back_by_function(file, e)?;
                self.parameter_yielded_by(file, func, argument, depth + 1)
            }
            _ => None,
        }
    }

    /// `e`: a call. If it names a function of the program that hands back a parameter: the argument for that.
    fn argument_handed_back_by_function(&mut self, file: FileId, e: ExprId) -> Option<ExprId> {
        let hir = self.hir(file);
        let ExprKind::Call(call) = hir[e].kind else { return None };
        let ExprKind::Ident(name) = hir[hir[call].callee].kind else { return None };
        if hir[call].chain != Chain::No {
            return None;
        }
        let sym = self.symbol_of_identifier(file, hir[call].callee, name)?;
        let sym = if self.files().flags(sym).contains(SymFlags::ALIAS) { self.files().resolve_alias(sym)? } else { sym };
        let (of, func) = match self.function_declared_as(sym) {
            Some(declared) => declared,
            None => self.only_function_of_variable(sym).filter(|only| !only.may_be_nil && !only.is_predicted).map(|only| (only.file, only.func))?,
        };
        let number = self.parameter_handed_back_by(of, func)?;
        let mut arguments = hir.ids(hir[call].args);
        let is_spread = |argument: &ExprId| matches!(hir[*argument].kind, ExprKind::Spread(_) | ExprKind::Missing);
        for _ in 0..number {
            arguments.next().filter(|argument| !is_spread(argument))?;
        }
        arguments.next().filter(|argument| !is_spread(argument))
    }

    /// The function that the name stands for wherever it is in scope: one declaration with a body, in a module of the program, also within a
    /// namespace (`namespace Parser { function finishNode(..) {..} }`), and nothing is assigned to the name.
    fn function_declared_as(&self, sym: Sym) -> Option<(FileId, FnId)> {
        let (file, decl @ Decl::Fn(_)) = self.files().value_declaration(sym)? else { return None };
        let (hir, bound) = (self.hir(file), self.bound(file));
        if hir.kind == FileKind::Declaration || self.is_untyped_file(file) {
            return None;
        }
        let local = bound.symbol_of_declaration(decl);
        let symbol = bound.symbols.get(local.idx())?;
        if symbol.flags.contains(SymFlags::MERGED) || !bound.assignments_to(local).is_empty() {
            return None;
        }
        let mut with_body = None;
        for decl in symbol.decls.iter() {
            let func = match *decl {
                Decl::Fn(func) => func,
                _ if self.declares_only_a_type(sym, *decl) => continue,
                _ => return None,
            };
            if !matches!(hir[func].body, FnBody::None) && with_body.replace(func).is_some() {
                return None;
            }
        }
        with_body.map(|func| (file, func))
    }

    /// `import { Node } from ".."; function Node(..) {..}`, `let SourceMapSource: ..` beside the import of the interface: one symbol, which is what the file
    /// declares as a value and what is imported as a type.
    fn is_value_beside_imported_type(&self, sym: Sym) -> bool {
        let files = self.files();
        let flags = files.flags(sym);
        flags.contains(SymFlags::ALIAS) && flags.intersects(SymFlags::FUNCTION | SymFlags::VARIABLE) && files.resolve_alias(sym).is_some_and(|imported| !files.flags(imported).intersects(SymFlags::VALUE | SymFlags::ALIAS))
    }

    /// Whether the declaration of the symbol gives it no value: `interface Sym {..}` beside `function Sym(..) {..}`, `type Kind = ..` beside `const Kind = ..`.
    fn declares_only_a_type(&self, sym: Sym, decl: Decl) -> bool {
        match decl {
            Decl::Interface(_) | Decl::Alias(_) => true,
            Decl::ImportSpec(_) | Decl::ImportDefault(_) => self.is_value_beside_imported_type(sym),
            _ => false,
        }
    }

    /// `declared_by`: the statement that declares a variable. Whether something besides an assignment to the name stores to it. What a
    /// namespace exports is stored to as `ns.name = value` too. The variable of `for (let f = ..; ..; ..)` is copied to a new environment at
    /// every turn, and that of `for (f of ..)` is bound by the loop.
    fn is_stored_to_otherwise(&self, file: FileId, declared_by: StmtId, is_exported: bool) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut parent = bound.stmt_parent[declared_by.idx()];
        if matches!(parent, Parent::Stmt(by) if by.is_some() && matches!(hir[by].kind, StmtKind::For { .. } | StmtKind::ForIn { .. } | StmtKind::ForOf { .. })) {
            return true;
        }
        loop {
            parent = match parent {
                Parent::Stmt(around) if around.is_some() => bound.stmt_parent[around.idx()],
                Parent::Module(_) => return is_exported,
                _ => return false,
            };
        }
    }

    /// The one function of the program that the value of the expression is a closure of, if it is a function at all, as far as the trees tell. A
    /// prediction.
    pub fn function_yielded_by(&mut self, file: FileId, e: ExprId) -> Option<(FileId, FnId)> {
        match self.callee_yielded_by(file, e, 0).callee {
            Callee::One(file, func) => Some((file, func)),
            _ => None,
        }
    }

    /// The functions that the value of the expression may be a closure of, and whether it may be `undefined` or `null` instead.
    pub(super) fn callee_yielded_by(&mut self, file: FileId, e: ExprId, depth: u32) -> Yielded {
        let hir = self.hir(file);
        let unknown = Yielded::of(Callee::Unknown(Place { file, pos: hir[e].pos }), false);
        if depth > DEEPEST_OPERAND {
            return unknown;
        }
        match hir[e].kind {
            // None of them makes another object of a function.
            ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::Instantiation { expr, .. } | ExprKind::NonNull(expr) | ExprKind::AsConst(expr) => self.callee_yielded_by(file, expr, depth + 1),
            ExprKind::Fn(func) if matches!(hir[func].kind, FnKind::Expr | FnKind::Arrow | FnKind::Method) => Yielded::of(Callee::One(file, func), false),
            ExprKind::Null | ExprKind::Unary { op: UnOp::Void, .. } => Yielded::of(Callee::Nothing, true),
            ExprKind::Ident(name) if self.bound(file).expr_symbol[e.idx()].is_none() && self.atoms().bytes(name) == b"undefined" => Yielded::of(Callee::Nothing, true),
            ExprKind::Ident(name) => {
                let Some(sym) = self.symbol_of_identifier(file, e, name) else { return unknown };
                let sym = if self.files().flags(sym).contains(SymFlags::ALIAS) && !self.is_value_beside_imported_type(sym) { self.files().resolve_alias(sym) } else { Some(sym) };
                match sym.and_then(|sym| self.only_function_of_variable(sym)) {
                    Some(only) => {
                        if let Some(came_by) = &mut self.aot.callees.came_by {
                            came_by.push(only.outermost);
                        }
                        Yielded { callee: Callee::One(only.file, only.func), may_be_nil: only.may_be_nil, is_predicted: only.is_predicted }
                    }
                    None => unknown,
                }
            }
            ExprKind::Cond { yes, no, .. } => self.callee_yielded_by(file, yes, depth + 1).join(self.callee_yielded_by(file, no, depth + 1)),
            // What the one function that is probably called returns. Another may be called, so it is a prediction.
            ExprKind::Call(call) => {
                let called = match hir[hir[call].callee].kind {
                    ExprKind::Dot { obj, name, .. } => self.callee_in_literal_held_by(file, obj, name, depth + 1),
                    _ => self.callee_yielded_by(file, hir[call].callee, depth + 1).callee,
                };
                let Callee::One(of, func) = called else { return unknown };
                let (declaring, bound) = (self.hir(of), self.bound(of));
                let returned = match declaring[func].body {
                    FnBody::None => return unknown,
                    FnBody::Expr(body) => self.callee_yielded_by(of, body, depth + 1),
                    FnBody::Block(_) => bound.ids(bound.fns[func.idx()].returns).fold(Yielded::of(Callee::Nothing, false), |so_far, stmt: StmtId| match declaring[stmt].kind {
                        StmtKind::Return(value) if value.is_some() => so_far.join(self.callee_yielded_by(of, value, depth + 1)),
                        _ => so_far.join(Yielded::of(Callee::Nothing, true)),
                    }),
                };
                Yielded { is_predicted: true, ..returned }
            }
            // What the literal has by the name, which may have been replaced since.
            ExprKind::Dot { obj, name, .. } => Yielded { is_predicted: true, ..Yielded::of(self.callee_in_literal_held_by(file, obj, name, depth + 1), false) },
            ExprKind::Binary { op: BinOp::Comma, right, .. } | ExprKind::Assign { op: None, value: right, .. } => self.callee_yielded_by(file, right, depth + 1),
            // A function is truthy, and nil is neither.
            ExprKind::Binary { op: BinOp::Or | BinOp::Nullish, left, right } | ExprKind::Assign { op: Some(BinOp::Or | BinOp::Nullish), target: left, value: right } => {
                let (left, right) = (self.callee_yielded_by(file, left, depth + 1), self.callee_yielded_by(file, right, depth + 1));
                Yielded { may_be_nil: right.may_be_nil, ..left.join(right) }
            }
            _ => unknown,
        }
    }

    /// The object literal that the value of the expression is made by, as far as the trees tell: the literal itself, under `as`, `!`, `satisfies`; a variable that is initialized with
    /// one; an import of `export default { .. }`.
    fn literal_yielded_by(&mut self, file: FileId, e: ExprId, depth: u32) -> Option<(FileId, ExprId)> {
        let hir = self.hir(file);
        if depth > DEEPEST_OPERAND {
            return None;
        }
        match hir[e].kind {
            ExprKind::Object(_) => Some((file, e)),
            ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) | ExprKind::AsConst(expr) => self.literal_yielded_by(file, expr, depth + 1),
            ExprKind::Ident(variable) => {
                let sym = self.symbol_of_identifier(file, e, variable)?;
                let sym = if self.files().flags(sym).contains(SymFlags::ALIAS) { self.files().resolve_alias(sym)? } else { sym };
                if let Some((of, exported)) = self.expression_exported_as(sym) {
                    return self.literal_yielded_by(of, exported, depth + 1);
                }
                let (of, Decl::Var(pat)) = self.files().value_declaration(sym)? else { return None };
                let declaring = self.hir(of);
                let PatParent::Var(d) = root_declaration(self.bound(of), pat) else { return None };
                if declaring[d].pat != pat {
                    return None;
                }
                self.literal_yielded_by(of, declaring[d].init.some()?, depth + 1)
            }
            _ => None,
        }
    }

    /// `obj.name`, where `obj` stands for an object literal (`literal_yielded_by`): what the literal has by the name. Something else may
    /// have been stored there since, so it is a prediction.
    fn callee_in_literal_held_by(&mut self, file: FileId, obj: ExprId, name: Atom, depth: u32) -> Callee {
        let unknown = Callee::Unknown(Place { file, pos: self.hir(file)[obj].pos });
        let Some((of, init)) = self.literal_yielded_by(file, obj, depth) else { return unknown };
        let hir = self.hir(of);
        let ExprKind::Object(props) = hir[init].kind else { return unknown };
        let found = props.iter().filter(|p| matches!(hir[*p].key, PropKey::Name(key) if key == name) && matches!(hir[*p].kind, PropKind::Init | PropKind::Shorthand | PropKind::Method));
        match found.last() {
            Some(p) => self.callee_yielded_by(of, hir[p].value, depth).callee,
            None => unknown,
        }
    }
}

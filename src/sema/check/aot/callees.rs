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
//! (`Checker::record_stored_callee`) and joined over the subtype sets when it is linked (`Subtypes::finish`). An untyped store (`(o as any).f =
//! g`, `o[key] = g`, `Object.assign`) is not among them, so what comes of them is a PREDICTION: the call tests for it.

use super::flows::Place;
use crate::bind::{Decl, FnOwner, Parent, PatParent, ScopeKind, SymFlags};
use crate::check::Checker;
use crate::check::errors_names_and_exports::root_declaration;
use crate::atom::Atom;
use crate::hir::{BinOp, Chain, ClassId, ExprId, ExprKind, Flags, FnBody, FnId, FnKind, IdList, PatKind, PropKey, PropKind, StmtId, StmtKind, UnOp, VarKind};
use crate::program::{FileId, Sym};
use crate::util::FxHashMap;

/// An expression that is nested more deeply than this in operators that hand on an operand is not seen through.
const MAX_OPERAND_DEPTH: u32 = 16;

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

/// See `Checker::variable_single_function`.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct SingleFunction {
    pub file: FileId,
    pub func: FnId,
    /// A read may also find `undefined` or `null`: one of the stores puts it there, or a read may come before the first store.
    pub may_be_nullish: bool,
    /// Which FUNCTION is known, not which closure. `let g; function outer(y) { const made = () => y; if (!g) g = made; const f = g!; f() }`: `f` holds a
    /// closure that another call of `outer` has made. This is the outermost of the variables that the closures have come by, `g` here,
    /// and the variable itself if every store to it makes the closure. All closures that get to the variable are made within one
    /// activation of the scope that binds this one, so what the function captures from there or from further out is the same for all.
    pub outermost: Sym,
    /// One of the stores is only expected to put a closure of the function there: what a call of something that is not known for certain yields. Then nothing is a fact.
    pub is_predicted: bool,
}

/// What `Checker::result_callees_of` finds.
#[derive(Copy, Clone)]
pub(super) struct ResultCallees {
    pub callee: Callee,
    pub may_be_nullish: bool,
    pub is_predicted: bool,
}

impl ResultCallees {
    fn of(callee: Callee, may_be_nullish: bool) -> ResultCallees {
        ResultCallees { callee, may_be_nullish, is_predicted: false }
    }

    fn join(self, other: ResultCallees) -> ResultCallees {
        ResultCallees { callee: self.callee.join(other.callee), may_be_nullish: self.may_be_nullish || other.may_be_nullish, is_predicted: self.is_predicted || other.is_predicted }
    }

    fn is_opaque(self) -> bool {
        matches!(self.callee, Callee::Unknown(_))
    }
}

#[derive(Default)]
pub(super) struct State {
    of_variables: FxHashMap<Sym, Option<SingleFunction>>,
    /// While the stores to a variable are gone through: `SingleFunction::outermost` of the variables that they name.
    visited_variables: Option<Vec<Sym>>,
    /// `returned_parameter`, as far as it has been asked.
    handed_back: FxHashMap<(FileId, FnId), Option<u32>>,
}

impl<'p, 's> Checker<'p, 's> {
    /// `sym`: a variable or a function declaration. The function that every function it ever holds is a closure of. Each of those closures
    /// is made where the store is, or is what a name stands for there. So its environment is the one that is in scope at the store: if that
    /// has the layout of the environment that holds the variable, it is that very environment.
    ///
    /// It goes by the trees and the symbols alone: every task finds the same.
    pub fn variable_single_function(&mut self, sym: Sym) -> Option<SingleFunction> {
        if let Some(&known) = self.aot.callees.of_variables.get(&sym) {
            return known;
        }
        // One that is stored to itself by way of another has none, whichever of them is asked about first.
        self.aot.callees.of_variables.insert(sym, None);
        let around = self.aot.callees.visited_variables.replace(Vec::new());
        let found = self.find_variable_single_function(sym);
        let visited_variables = std::mem::replace(&mut self.aot.callees.visited_variables, around).unwrap_or_default();
        let found = found.map(|only| {
            let mut outermost = (self.scope_depth(sym), sym);
            for other in visited_variables {
                let scopes = self.scope_depth(other);
                if scopes < outermost.0 {
                    outermost = (scopes, other);
                }
            }
            SingleFunction { outermost: outermost.1, ..only }
        });
        self.aot.callees.of_variables.insert(sym, found);
        found
    }

    /// How many scopes are around what binds the variable, that one too. Of two variables that one piece of code sees, the one with fewer is
    /// the outer one. What another module declares is at its top level.
    fn scope_depth(&self, sym: Sym) -> u32 {
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
    fn default_export_expression(&self, sym: Sym) -> Option<(FileId, ExprId)> {
        self.files().decls_of(sym).iter().copied().find_map(|(file, decl)| match decl {
            Decl::ExportExpr(stmt) => match self.hir(file)[stmt].kind {
                StmtKind::ExportDefault(value) | StmtKind::ExportAssign(value) => Some((file, value)),
                _ => None,
            },
            _ => None,
        })
    }

    fn find_variable_single_function(&mut self, sym: Sym) -> Option<SingleFunction> {
        // `export default EventEmitter as any`, by way of an import. Nothing else is ever bound to it. It is left a prediction.
        if let Some((file, value)) = self.default_export_expression(sym) {
            if self.is_declaration_only(file) {
                return None;
            }
            let exported = self.result_callees_of(file, value, 0);
            let Callee::One(file, func) = exported.callee else { return None };
            return Some(SingleFunction { file, func, may_be_nullish: exported.may_be_nullish, outermost: sym, is_predicted: true });
        }
        let (file, decl) = self.variable_declaration(sym)?;
        let (hir, bound) = (self.hir(file), self.bound(file));
        // What a declaration file declares, other code stores to. What a script declares, the other scripts see.
        if self.is_declaration_only(file) || !self.files().module(file).is_module() {
            return None;
        }
        let local = bound.symbol_of_declaration(decl);
        let symbol = bound.symbols.get(local.idx())?;
        if symbol.flags.contains(SymFlags::MERGED) {
            return None;
        }
        let (declared_by, mut stored) = match decl {
            Decl::Var(pat) => {
                let PatParent::Var(d) = root_declaration(bound, pat) else { return None };
                let is_declared_by_statement = bound.var_stmt[d.idx()].some().is_some_and(|stmt| matches!(hir[stmt].kind, StmtKind::Var(_)));
                if !is_declared_by_statement || symbol.decls.iter().filter(|&&decl| !self.is_type_only_declaration(sym, decl)).count() != 1 || hir[d].flags.contains(Flags::AMBIENT) {
                    return None;
                }
                let first = if hir[d].pat != pat {
                    // `const { Stream } = legacy`: what the literal has by the name, which may have been replaced since. `const { Stream } = require("./legacy")`: what the variable of that export holds.
                    let PatParent::Prop(outer, prop) = bound.pat_parent[pat.idx()] else { return None };
                    let name = match (hir[prop].key, hir[pat].kind) {
                        _ if outer != hir[d].pat || hir[prop].is_rest || hir[prop].default.is_some() || hir[d].init.is_none() => return None,
                        (PropKey::Name(name), _) | (PropKey::None, PatKind::Ident(name)) => name,
                        _ => return None,
                    };
                    let exported = self.exports_reference(file, hir[d].init).filter(|mention| !mention.is_boxed).and_then(|mention| match mention.is_namespace {
                        true => self.imported_export_variable(file, mention.module, name),
                        false => self.export_variable_for(mention.module, name),
                    });
                    match exported {
                        Some((module, exported)) => {
                            let (of, func, is_predicted) = self.outside_variable_query(|this| this.export_variable_function(module, exported, 1))?;
                            ResultCallees { is_predicted, ..ResultCallees::of(Callee::One(of, func), true) }
                        }
                        None => ResultCallees { is_predicted: true, ..ResultCallees::of(self.callee_in_literal(file, hir[d].init, name, 0), false) },
                    }
                } else if hir[d].init.is_some() {
                    self.result_callees_of(file, hir[d].init, 0)
                } else {
                    ResultCallees::of(Callee::Nothing, false)
                };
                (bound.var_stmt[d.idx()], first)
            }
            // Overloads are declarations without a body.
            Decl::Fn(_) => {
                let mut with_body = None;
                for decl in symbol.decls.iter() {
                    let func = match *decl {
                        Decl::Fn(func) => func,
                        _ if self.is_type_only_declaration(sym, *decl) => continue,
                        _ => return None,
                    };
                    if !matches!(hir[func].body, FnBody::None) && with_body.replace(func).is_some() {
                        return None;
                    }
                }
                let func = with_body?;
                let FnOwner::Stmt(stmt) = bound.fns[func.idx()].owner else { return None };
                (stmt, ResultCallees::of(Callee::One(file, func), false))
            }
            _ => return None,
        };
        if declared_by.is_none() || self.is_assigned_indirectly(file, declared_by, bound.modifier_flags(hir, decl).contains(Flags::EXPORT)) {
            return None;
        }
        if self.is_stored_through_casts(file, local) {
            return None;
        }
        for &(_, target) in bound.assignments_to(local) {
            let Some(super::integers::Store::Value(value)) = self.target_store(file, target) else { return None };
            stored = stored.join(self.result_callees_of(file, value, 0));
        }
        let Callee::One(file, func) = stored.callee else { return None };
        let is_predicted = stored.is_predicted || self.is_reallocated_by_untyped_clone(file, func, sym);
        Some(SingleFunction { file, func, may_be_nullish: stored.may_be_nullish || self.starts_undefined(sym), outermost: sym, is_predicted })
    }

    pub fn variable_single_class(&self, sym: Sym) -> Option<(FileId, ClassId)> {
        let (file, decl) = self.variable_declaration(sym)?;
        let (hir, bound) = (self.hir(file), self.bound(file));
        if self.is_declaration_only(file) || !self.files().module(file).is_module() {
            return None;
        }
        let local = bound.symbol_of_declaration(decl);
        let symbol = bound.symbols.get(local.idx())?;
        let Decl::Var(pat) = decl else { return None };
        let PatParent::Var(d) = root_declaration(bound, pat) else { return None };
        let declared_by = bound.var_stmt[d.idx()];
        let is_declared_by_statement = declared_by.some().is_some_and(|stmt| matches!(hir[stmt].kind, StmtKind::Var(_)));
        if !is_declared_by_statement
            || symbol.flags.contains(SymFlags::MERGED)
            || symbol.decls.len() != 1
            || hir[d].flags.contains(Flags::AMBIENT)
            || hir[d].pat != pat
            || hir[d].init.is_none()
            || self.is_assigned_indirectly(file, declared_by, bound.modifier_flags(hir, decl).contains(Flags::EXPORT))
            || self.is_stored_through_casts(file, local)
            || !bound.assignments_to(local).is_empty()
        {
            return None;
        }
        let mut init = hir[d].init;
        while let ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) = hir[init].kind {
            init = expr;
        }
        let ExprKind::Class(class) = hir[init].kind else { return None };
        (!self.files().has_decorator(file, class)).then_some((file, class))
    }

    fn is_reallocated_by_untyped_clone(&self, file: FileId, func: FnId, sym: Sym) -> bool {
        if self.is_untyped_file(file) {
            return false;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut enclosing_functions: Vec<FnId> = Vec::new();
        if let Some((of, decl)) = self.files().value_declaration(sym)
            && of == file
        {
            let mut scope = bound.scope_of_declaration(hir, decl);
            while scope.is_some() {
                if let ScopeKind::Fn(around) | ScopeKind::Param(around) = bound.scopes[scope.idx()].kind {
                    enclosing_functions.push(around);
                }
                scope = bound.scopes[scope.idx()].parent;
            }
        }
        self.is_inside_cloneable_function(file, func, &enclosing_functions)
    }

    pub(super) fn is_inside_cloneable_function(&self, file: FileId, func: FnId, enclosing_functions: &[FnId]) -> bool {
        if self.is_untyped_file(file) {
            return false;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut around = bound.fns[func.idx()].enclosing;
        while around.is_some() && !enclosing_functions.contains(&around) {
            let f = &hir[around];
            let may_have_untyped_clone = !matches!(f.body, FnBody::None)
                && !f.flags.contains(Flags::GENERATOR)
                && match f.kind {
                    FnKind::Method | FnKind::Getter | FnKind::Setter => true,
                    FnKind::Decl | FnKind::Expr | FnKind::Arrow => !f.flags.contains(Flags::ASYNC) && f.params.iter().any(|p| hir[p].ty.is_some()),
                    _ => false,
                };
            if may_have_untyped_clone {
                return true;
            }
            around = bound.fns[around.idx()].enclosing;
        }
        false
    }

    /// The parameter, by its number, that every call of the function hands back: `function setTextRange<T extends TextRange>(range: T, location) { return
    /// location ? setTextRangePosEnd(range, location.pos, location.end) : range }`. Every `return` yields it, by its name or through a call of
    /// a function that hands it back in turn, or does not return (`never`), and the end of the body is not reached. Nothing is stored to it, and it has no
    /// initializer. A FACT: it goes by the trees and the symbols alone, and every task finds the same.
    pub fn returned_parameter(&mut self, file: FileId, func: FnId) -> Option<u32> {
        if let Some(&known) = self.aot.callees.handed_back.get(&(file, func)) {
            return known;
        }
        // One that only hands back what it hands back itself never returns.
        self.aot.callees.handed_back.insert((file, func), None);
        let found = self.find_returned_parameter(file, func);
        self.aot.callees.handed_back.insert((file, func), found);
        found
    }

    fn find_returned_parameter(&mut self, file: FileId, func: FnId) -> Option<u32> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if hir[func].flags.intersects(Flags::ASYNC | Flags::GENERATOR) || !matches!(hir[func].kind, FnKind::Decl | FnKind::Expr | FnKind::Arrow) {
            return None;
        }
        let returned: Vec<ExprId> = match hir[func].body {
            FnBody::None => return None,
            FnBody::Expr(body) => vec![body],
            FnBody::Block(stmts) => {
                if !self.ends_with_exit(file, stmts) {
                    return None;
                }
                bound.ids(bound.fns[func.idx()].returns).map(|stmt: StmtId| if let StmtKind::Return(value) = hir[stmt].kind { value } else { ExprId::NONE }).collect()
            }
        };
        if self.mentions_arguments_object(file, func) || self.has_direct_eval(file) {
            return None;
        }
        let mut handed_back = None;
        for value in returned {
            let parameter = if value.is_some() { self.parameter_for_expr(file, func, value, 0)? } else { return None };
            if handed_back.replace(parameter).is_some_and(|other| other != parameter) {
                return None;
            }
        }
        handed_back
    }

    fn ends_with_exit(&self, file: FileId, stmts: IdList<StmtId>) -> bool {
        let hir = self.hir(file);
        let last = hir.ids(stmts).filter(|&stmt| !matches!(hir[stmt].kind, StmtKind::Fn(_) | StmtKind::Interface(_) | StmtKind::TypeAlias(_) | StmtKind::Empty)).last();
        last.is_some_and(|last| self.leaves(file, last))
    }

    fn leaves(&self, file: FileId, stmt: StmtId) -> bool {
        match self.hir(file)[stmt].kind {
            StmtKind::Return(_) | StmtKind::Throw(_) => true,
            StmtKind::Block(stmts) => self.ends_with_exit(file, stmts),
            StmtKind::If { yes, no, .. } => no.is_some() && self.leaves(file, yes) && self.leaves(file, no),
            _ => false,
        }
    }

    /// `e`: an expression in the body of `func`. The parameter of `func` that is its value, whenever it has one.
    fn parameter_for_expr(&mut self, file: FileId, func: FnId, e: ExprId, depth: u32) -> Option<u32> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if depth > MAX_OPERAND_DEPTH {
            return None;
        }
        match hir[e].kind {
            // `as` may make another object of plain data.
            ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) => self.parameter_for_expr(file, func, expr, depth + 1),
            ExprKind::Binary { op: BinOp::Comma, right, .. } => self.parameter_for_expr(file, func, right, depth + 1),
            ExprKind::Cond { yes, no, .. } => {
                let yes = self.parameter_for_expr(file, func, yes, depth + 1)?;
                (self.parameter_for_expr(file, func, no, depth + 1)? == yes).then_some(yes)
            }
            ExprKind::Ident(name) => {
                let sym = self.symbol_of_identifier(file, e, name)?;
                let (declared_in, Decl::Param(pat)) = self.files().value_declaration(sym)? else { return None };
                let PatParent::Param(parameter) = bound.pat_parent[pat.idx()] else { return None };
                if declared_in != file || bound.param_fn[parameter.idx()] != func || !matches!(hir[pat].kind, PatKind::Ident(_)) {
                    return None;
                }
                let local = bound.symbol_of_declaration(Decl::Param(pat));
                let is_declared_once = bound.symbols.get(local.idx()).is_some_and(|symbol| matches!(symbol.decls.as_slice(), [Decl::Param(_)]));
                let references_body_function = matches!(hir[func].body, FnBody::Block(stmts) if hir.ids(stmts).any(|stmt| matches!(hir[stmt].kind, StmtKind::Fn(inner) if hir[inner].name == name)));
                let is_plain = hir[parameter].default.is_none()
                    && !hir[parameter].flags.contains(Flags::REST)
                    && is_declared_once
                    && !references_body_function
                    && bound.assignments_to(local).is_empty()
                    && !self.is_stored_through_casts(file, local)
                    && !self.is_stored_through_assertions(file, local);
                let number = hir[func].params.iter().position(|other| other == parameter)?;
                is_plain.then_some(number as u32)
            }
            ExprKind::Call(_) => {
                let argument = self.returned_argument_of_function(file, e)?;
                self.parameter_for_expr(file, func, argument, depth + 1)
            }
            _ => None,
        }
    }

    /// `e`: a call. If it names a function of the program that hands back a parameter: the argument for that.
    pub fn is_argument_returned_by_call(&mut self, file: FileId, e: ExprId) -> bool {
        let Parent::Expr(call) = self.bound(file).expr_parent[e.idx()] else { return false };
        if call.is_none() || self.returned_argument_of_function(file, call) != Some(e) {
            return false;
        }
        let Some((of, func, _)) = self.resolved_signature(file, call).sig.and_then(|sig| self.sig_decl(sig)) else { return false };
        let Some(number) = self.returned_parameter(of, func) else { return false };
        let Some(parameter) = self.hir(of)[func].params.iter().nth(number as usize) else { return false };
        let declared = self.type_of_param(of, parameter);
        self.base_constraint_of(declared).is_none_or(|bound| self.is_uninformative(bound))
    }

    pub(super) fn returned_argument_of_function(&mut self, file: FileId, e: ExprId) -> Option<ExprId> {
        let hir = self.hir(file);
        let ExprKind::Call(call) = hir[e].kind else { return None };
        let ExprKind::Ident(name) = hir[hir[call].callee].kind else { return None };
        if hir[call].chain != Chain::No {
            return None;
        }
        let sym = self.symbol_of_identifier(file, hir[call].callee, name)?;
        let sym = if self.files().flags(sym).contains(SymFlags::ALIAS) { self.files().resolve_alias(sym)? } else { sym };
        if self.is_assigned_through_cast(sym) {
            return None;
        }
        let (of, func) = match self.function_declaration_for(sym) {
            Some(declared) => declared,
            None => self.variable_single_function(sym).filter(|only| !only.may_be_nullish && !only.is_predicted).map(|only| (only.file, only.func))?,
        };
        let number = self.returned_parameter(of, func)?;
        let mut arguments = hir.ids(hir[call].args);
        let is_spread = |argument: &ExprId| matches!(hir[*argument].kind, ExprKind::Spread(_) | ExprKind::Missing);
        for _ in 0..number {
            arguments.next().filter(|argument| !is_spread(argument))?;
        }
        arguments.next().filter(|argument| !is_spread(argument))
    }

    /// The function that the name stands for wherever it is in scope: one declaration with a body, in a module of the program, also within a
    /// namespace (`namespace Parser { function finishNode(..) {..} }`), and nothing is assigned to the name.
    fn function_declaration_for(&self, sym: Sym) -> Option<(FileId, FnId)> {
        let (file, decl @ Decl::Fn(_)) = self.files().value_declaration(sym)? else { return None };
        let (hir, bound) = (self.hir(file), self.bound(file));
        if self.is_declaration_only(file) || self.is_untyped_file(file) {
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
                _ if self.is_type_only_declaration(sym, *decl) => continue,
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
    fn is_value_merged_with_imported_type(&self, sym: Sym) -> bool {
        let files = self.files();
        let flags = files.flags(sym);
        flags.contains(SymFlags::ALIAS) && flags.intersects(SymFlags::FUNCTION | SymFlags::VARIABLE) && files.resolve_alias(sym).is_some_and(|imported| !files.flags(imported).intersects(SymFlags::VALUE | SymFlags::ALIAS))
    }

    /// Whether the declaration of the symbol gives it no value: `interface Sym {..}` beside `function Sym(..) {..}`, `type Kind = ..` beside `const Kind = ..`.
    fn is_type_only_declaration(&self, sym: Sym, decl: Decl) -> bool {
        match decl {
            Decl::Interface(_) | Decl::Alias(_) => true,
            Decl::ImportSpec(_) | Decl::ImportDefault(_) => self.is_value_merged_with_imported_type(sym),
            _ => false,
        }
    }

    /// `declared_by`: the statement that declares a variable. Whether something besides an assignment to the name stores to it. What a
    /// namespace exports is stored to as `ns.name = value` too. The variable of `for (let f = ..; ..; ..)` is copied to a new environment at
    /// every turn, and that of `for (f of ..)` is bound by the loop.
    fn is_assigned_indirectly(&self, file: FileId, declared_by: StmtId, is_exported: bool) -> bool {
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
    pub fn function_for_value_expr(&mut self, file: FileId, e: ExprId) -> Option<(FileId, FnId)> {
        match self.result_callees_of(file, e, 0).callee {
            Callee::One(file, func) => Some((file, func)),
            _ => None,
        }
    }

    /// What `find` asks is no part of what is being asked about a variable: `SingleFunction::outermost` of that one is the same whether or not it has been asked before.
    pub(super) fn outside_variable_query<R>(&mut self, find: impl FnOnce(&mut Self) -> R) -> R {
        let around = self.aot.callees.visited_variables.take();
        let found = find(self);
        self.aot.callees.visited_variables = around;
        found
    }

    /// The functions that the value of the expression may be a closure of, and whether it may be `undefined` or `null` instead.
    pub(super) fn result_callees_of(&mut self, file: FileId, e: ExprId, depth: u32) -> ResultCallees {
        let hir = self.hir(file);
        let unknown = ResultCallees::of(Callee::Unknown(Place { file, pos: hir[e].pos }), false);
        if depth > MAX_OPERAND_DEPTH {
            return unknown;
        }
        match hir[e].kind {
            // None of them makes another object of a function.
            ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::Instantiation { expr, .. } | ExprKind::NonNull(expr) | ExprKind::AsConst(expr) => self.result_callees_of(file, expr, depth + 1),
            ExprKind::Fn(func) if matches!(hir[func].kind, FnKind::Expr | FnKind::Arrow | FnKind::Method) => ResultCallees::of(Callee::One(file, func), false),
            ExprKind::Null | ExprKind::Unary { op: UnOp::Void, .. } => ResultCallees::of(Callee::Nothing, true),
            ExprKind::Ident(name) if self.bound(file).expr_symbol[e.idx()].is_none() && self.atoms().bytes(name) == b"undefined" => ResultCallees::of(Callee::Nothing, true),
            ExprKind::Ident(name) => {
                let Some(sym) = self.symbol_of_identifier(file, e, name) else { return unknown };
                let sym = if self.files().flags(sym).contains(SymFlags::ALIAS) && !self.is_value_merged_with_imported_type(sym) { self.files().resolve_alias(sym) } else { Some(sym) };
                match sym.and_then(|sym| self.variable_single_function(sym)) {
                    Some(only) => {
                        if let Some(visited_variables) = &mut self.aot.callees.visited_variables {
                            visited_variables.push(only.outermost);
                        }
                        ResultCallees { callee: Callee::One(only.file, only.func), may_be_nullish: only.may_be_nullish, is_predicted: only.is_predicted }
                    }
                    None => unknown,
                }
            }
            ExprKind::Cond { yes, no, .. } => {
                let yes = self.result_callees_of(file, yes, depth + 1);
                if yes.is_opaque() { yes } else { yes.join(self.result_callees_of(file, no, depth + 1)) }
            }
            // What the module exports. Whoever requires it while it is evaluated finds something else: then it is a prediction.
            ExprKind::Call(_) if self.required_function(file, e).is_some() => match self.required_function(file, e) {
                Some((of, func, is_sure)) => ResultCallees { is_predicted: !is_sure, ..ResultCallees::of(Callee::One(of, func), false) },
                None => unknown,
            },
            // What the one function that is called returns. Where another may be called, it is a prediction.
            ExprKind::Call(call) => {
                let (called, is_sure) = match hir[hir[call].callee].kind {
                    ExprKind::Dot { obj, name, .. } => (self.callee_in_literal(file, obj, name, depth + 1), false),
                    _ => {
                        let callee = self.result_callees_of(file, hir[call].callee, depth + 1);
                        (callee.callee, !callee.is_predicted && hir[call].chain == Chain::No)
                    }
                };
                let Callee::One(of, func) = called else { return unknown };
                let (declaring, bound) = (self.hir(of), self.bound(of));
                let returned = match declaring[func].body {
                    FnBody::None => return unknown,
                    FnBody::Expr(body) => self.result_callees_of(of, body, depth + 1),
                    FnBody::Block(stmts) => {
                        let without_return = ResultCallees::of(Callee::Nothing, !self.ends_with_exit(of, stmts));
                        bound.ids(bound.fns[func.idx()].returns).fold(without_return, |so_far, stmt: StmtId| match declaring[stmt].kind {
                            _ if so_far.is_opaque() => so_far,
                            StmtKind::Return(value) if value.is_some() => so_far.join(self.result_callees_of(of, value, depth + 1)),
                            _ => so_far.join(ResultCallees::of(Callee::Nothing, true)),
                        })
                    }
                };
                let is_plain = !declaring[func].flags.intersects(Flags::ASYNC | Flags::GENERATOR);
                ResultCallees { is_predicted: returned.is_predicted || !is_sure || !is_plain, ..returned }
            }
            ExprKind::Dot { .. } | ExprKind::Index { .. } if self.export_variable_for_expr(file, e).is_some() => {
                let held = self.export_variable_for_expr(file, e).and_then(|(module, name)| self.outside_variable_query(|this| this.export_variable_function(module, name, depth + 1)));
                match held {
                    Some((of, func, is_predicted)) => ResultCallees { is_predicted, ..ResultCallees::of(Callee::One(of, func), true) },
                    None => unknown,
                }
            }
            // What the literal has by the name, which may have been replaced since.
            ExprKind::Dot { obj, name, .. } => ResultCallees { is_predicted: true, ..ResultCallees::of(self.callee_in_literal(file, obj, name, depth + 1), false) },
            ExprKind::Binary { op: BinOp::Comma, right, .. } | ExprKind::Assign { op: None, value: right, .. } => self.result_callees_of(file, right, depth + 1),
            // A function is truthy, and nil is neither.
            ExprKind::Binary { op: BinOp::Or | BinOp::Nullish, left, right } | ExprKind::Assign { op: Some(BinOp::Or | BinOp::Nullish), target: left, value: right } => {
                let left = self.result_callees_of(file, left, depth + 1);
                if left.is_opaque() {
                    return left;
                }
                let right = self.result_callees_of(file, right, depth + 1);
                ResultCallees { may_be_nullish: right.may_be_nullish, ..left.join(right) }
            }
            _ => unknown,
        }
    }

    /// The object literal that the value of the expression is made by, as far as the trees tell: the literal itself, under `as`, `!`, `satisfies`; a variable that is initialized with
    /// one; an import of `export default { .. }`.
    fn literal_for_value_expr(&mut self, file: FileId, e: ExprId, depth: u32) -> Option<(FileId, ExprId)> {
        let hir = self.hir(file);
        if depth > MAX_OPERAND_DEPTH {
            return None;
        }
        match hir[e].kind {
            ExprKind::Object(_) => Some((file, e)),
            ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) | ExprKind::AsConst(expr) => self.literal_for_value_expr(file, expr, depth + 1),
            ExprKind::Ident(variable) => {
                let sym = self.symbol_of_identifier(file, e, variable)?;
                let sym = if self.files().flags(sym).contains(SymFlags::ALIAS) { self.files().resolve_alias(sym)? } else { sym };
                if let Some((of, exported)) = self.default_export_expression(sym) {
                    return if self.is_declaration_only(of) { None } else { self.literal_for_value_expr(of, exported, depth + 1) };
                }
                let (of, Decl::Var(pat)) = self.files().value_declaration(sym)? else { return None };
                if self.is_declaration_only(of) {
                    return None;
                }
                let declaring = self.hir(of);
                let PatParent::Var(d) = root_declaration(self.bound(of), pat) else { return None };
                if declaring[d].pat != pat {
                    return None;
                }
                self.literal_for_value_expr(of, declaring[d].init.some()?, depth + 1)
            }
            _ => None,
        }
    }

    /// `obj.name`, where `obj` stands for an object literal (`literal_for_value_expr`): what the literal has by the name. Something else may
    /// have been stored there since, so it is a prediction.
    fn callee_in_literal(&mut self, file: FileId, obj: ExprId, name: Atom, depth: u32) -> Callee {
        let unknown = Callee::Unknown(Place { file, pos: self.hir(file)[obj].pos });
        let Some((of, init)) = self.literal_for_value_expr(file, obj, depth) else { return unknown };
        let hir = self.hir(of);
        let ExprKind::Object(props) = hir[init].kind else { return unknown };
        let found = props.iter().filter(|p| matches!(hir[*p].key, PropKey::Name(key) if key == name) && matches!(hir[*p].kind, PropKind::Init | PropKind::Shorthand | PropKind::Method));
        match found.last() {
            Some(p) => self.result_callees_of(of, hir[p].value, depth).callee,
            None => unknown,
        }
    }
}

//! Closure conversion: what each function captures, and where each captured variable lives.
//!
//! A function is handed what it needs from the code around it as a list of captures. A closure holds them, a direct call passes them.
//! There are no links between environments.
//!
//! **A variable that nothing stores to once an inner function can have seen it is copied.** It is a plain value in the function that
//! declares it and in every function that has a copy. A parameter nobody assigns to is the usual case.
//!
//! **Any other captured variable lives in an environment**, which is made when its scope is entered: a call of a function, an iteration of a
//! loop, a block. If one variable of a scope needs that, or there are more than `MOST_COPIES`, all the captured variables of the scope
//! live there. A block within such a scope that is in no loop of its own is entered at most once each time the scope is, and shares
//! the environment.
//!
//! **The closure of a function declaration is made where the name is first used as a value**, and kept, so that it is the same object
//! from then on. To keep it is to store to it after an inner function may have seen it. So where an inner function uses the name as a
//! value, it is kept in the environment, which is there for that reason alone if for no other. Where nothing can tell one closure from
//! another, because all that is ever done with them is to call them, none is kept: one is made at each use.
//!
//! **A class that is not evaluated once has an environment of its own**, which is all its members capture. What they need from outside
//! the class is stored to it when the class is evaluated.
//!
//! All of it goes by the trees and the symbols of one file, and by which functions of the program the callees in it are: every task finds
//! the same.

use super::escape::argument_use;
use super::storage::Site;
use crate::atom::Atom;
use crate::bind::{Decl, FnOwner, MemberOwner, Parent, PatParent, SymFlags};
use crate::check::Checker;
use crate::check::errors_names_and_exports::root_declaration;
use crate::hir::{Chain, ClassId, ExprId, ExprKind, ExprTag, Flags, FnBody, FnId, FnKind, MemberId, PatId, PropKey, StmtId, StmtKind, VarKind};
use crate::program::{FileId, Sym};
use crate::util::{FxHashMap, FxHashSet};
use std::sync::Arc;

/// An activation with more captured variables than this keeps them in an environment, whether or not they could be copied. A direct call
/// passes each copy as an argument.
const MOST_COPIES: usize = 4;

/// What has variables of its own each time it is entered.
#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub enum Activation {
    Call(FnId),
    /// Of a `for`, `for-in` or `for-of` statement, which binds variables of its own.
    Iteration(StmtId),
    /// An entry of a block, of the block of a `catch` clause with what that binds, or of a `switch` statement.
    Block(StmtId),
    /// An evaluation of a class that is not evaluated once.
    Class(ClassId),
    /// An evaluation of a function expression that has a name: it binds the name, which only the function sees, to the closure it makes.
    /// Where an activation is said to have ended: with the activation that evaluates the expression.
    Expression(FnId),
}

/// Whose `this` an arrow function sees.
#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub enum Receiver {
    /// There is none: `undefined`.
    None,
    /// That of the function, which is no arrow function.
    Function(FnId),
    /// The object that the constructor of the class initializes: the arrow function is in the initializer of an instance field.
    Instance(ClassId),
    /// The class object: it is in the initializer of a static field.
    Static(ClassId),
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub enum Capture {
    Environment(Activation),
    /// A copy of the variable.
    Variable(Sym),
    /// A copy of `this`. Never `Receiver::None` or `Receiver::Static`.
    This(Receiver),
    /// The `arguments` object of the function.
    Arguments(FnId),
    NewTarget(FnId),
    HomeObject(FnId),
}

/// Where a variable lives that a function other than the one that declares it refers to.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum CapturedVariable {
    Copied,
    /// The index among `Checker::environment_of`.
    InEnvironment(Activation, u32),
}

/// How the closure of a function declaration that captures something comes about where the name is used as a value.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum DeclaredClosure {
    /// Wherever it is used, nothing observes which object it is: `Checker::use_of_value`. One is made at each use.
    Unobserved,
    /// It is used in one place, which is evaluated at most once for each time the declaration is instantiated: it is made there.
    CreatedAtUse,
    /// It is used by the code that declares it alone: it is made when the scope of the declaration is entered, and a local variable holds it.
    CreatedAtEntry,
    /// The index among `Checker::environment_of`.
    KeptInEnvironment(Activation, u32),
}

/// Why a captured variable is not copied.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum NotCopied {
    /// It is stored to there.
    Stored(ExprId),
    /// `(a as T) = value`
    StoredThroughCast,
    /// The reference, in an inner function, may be evaluated or the function made before the variable is bound.
    SeenEarly(ExprId),
    /// A loop or a `catch` clause binds it, and an inner function that is not in the body refers to it here: in the initializer, the test or the
    /// update of a `for` statement, where the binding is another than the body's or is stored to afterwards; in what a `for-of` iterates
    /// over, where it is never bound.
    OutsideBody(ExprId),
    /// A `var`, a `using`, a merged declaration.
    Declaration,
    /// It keeps the closure of a function declaration that an inner function uses as a value there.
    KeepsClosure(ExprId),
}

/// Who evaluates a piece of code.
#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
enum Code {
    Module,
    Function(FnId),
    /// The constructor of the class, declared or not, with the initializers of the instance fields.
    Constructor(ClassId),
}

/// A node of the graph that needs are passed along.
#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
enum Node {
    Code(Code),
    /// The evaluation of the class: it needs what its members need from outside.
    Class(ClassId),
}

/// What a piece of code needs, before it is decided which variables are copied.
#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
enum Need {
    Variable(Sym),
    /// The closure of the function declaration, as a value.
    Closure(FnId),
    /// The environment, named after the first of the variables in it.
    Environment(Activation, Sym),
    This(Receiver),
    Arguments(FnId),
    NewTarget(FnId),
    HomeObject(FnId),
    Class(ClassId),
}

/// It is found again by each checker that asks: which function a callee is may take the checker's own tables to say.
#[derive(Default)]
pub(super) struct State {
    by_file: FxHashMap<FileId, Arc<FileCaptures>>,
}

#[derive(Default)]
struct FileCaptures {
    variables: FxHashMap<Sym, CapturedVariable>,
    not_copied: FxHashMap<Sym, NotCopied>,
    /// By activation that has an environment: the variables in it, in the order of their declarations.
    environments: FxHashMap<Activation, Vec<Sym>>,
    of_functions: FxHashMap<FnId, Vec<Capture>>,
    /// `function_captures`
    capturing: FxHashSet<FnId>,
    /// The classes whose constructor captures the environment of the class.
    capturing_constructors: FxHashSet<ClassId>,
    /// By class that is not evaluated once: what its members need from outside.
    imports: FxHashMap<ClassId, Vec<Capture>>,
    declared_closures: FxHashMap<FnId, DeclaredClosure>,
    /// The loops where what is evaluated before the first iteration makes a function that refers to a variable the loop binds.
    captured_before_iterations: FxHashSet<StmtId>,
    receivers: FxHashMap<FnId, Receiver>,
    /// By function expression whose one closure per environment that environment keeps: the index of the field, behind the variables.
    kept_expressions: FxHashMap<FnId, (Activation, u32)>,
    expressions_kept: FxHashMap<Activation, Vec<FnId>>,
    generators_called_through_closures: FxHashSet<ExprId>,
}

/// A reference to something that is not there once and for all.
struct Reference {
    e: ExprId,
    sym: Sym,
    decl: Decl,
    /// Who evaluates the reference, and whose activation holds what is referred to.
    code: Code,
    holder: Code,
}

impl<'p, 's> Checker<'p, 's> {
    fn captures_of_file(&mut self, file: FileId) -> Arc<FileCaptures> {
        if let Some(known) = self.aot.captures.by_file.get(&file) {
            return known.clone();
        }
        let found = Arc::new(self.find_captures_of_file(file));
        self.aot.captures.by_file.insert(file, found.clone());
        found
    }

    /// What the function is handed ahead of `this` and its arguments, in order. Of a member of a class that is not evaluated once: the
    /// environment of the class, or nothing.
    pub fn captures_of_fn(&mut self, file: FileId, func: FnId) -> Vec<Capture> {
        self.captures_of_file(file).of_functions.get(&func).cloned().unwrap_or_default()
    }

    /// Whether the function needs anything that is not there once and for all: it, or a function within it, refers to a variable, a function
    /// or a class of an activation around it, or to `super` or a `#name`, which are kept with the class. One that does not can be called by
    /// whoever knows it, without its closure.
    pub fn function_captures(&mut self, file: FileId, func: FnId) -> bool {
        self.captures_of_file(file).capturing.contains(&func)
    }

    /// Whether the constructor of the class, declared or not, is handed the environment of the class: for its body, the initializers of the
    /// instance fields, the definition of what has a name that is kept with the class, or the constructor of what the class extends.
    pub fn constructor_captures(&mut self, file: FileId, class: ClassId) -> bool {
        self.captures_of_file(file).capturing_constructors.contains(&class)
    }

    /// What the members of a class that is not evaluated once need from outside the class, in order. It is stored to the environment of
    /// the class when the class is evaluated.
    pub fn imports_of_class(&mut self, file: FileId, class: ClassId) -> Vec<Capture> {
        self.captures_of_file(file).imports.get(&class).cloned().unwrap_or_default()
    }

    /// The variables that live in the environment of the activation, in order. Empty: it has none.
    pub fn environment_of(&mut self, file: FileId, activation: Activation) -> Vec<Sym> {
        self.captures_of_file(file).environments.get(&activation).cloned().unwrap_or_default()
    }

    /// Whether what is evaluated before the first iteration of the loop makes a function that refers to a variable the loop binds. In the
    /// initializer of a `for` statement: that function has the bindings as the initializer left them for good, and each iteration, the
    /// first too, has copies. In what a `for-in` or `for-of` statement iterates over: it has bindings that are never initialized.
    pub fn is_captured_before_iterations(&mut self, file: FileId, statement: StmtId) -> bool {
        self.captures_of_file(file).captured_before_iterations.contains(&statement)
    }

    pub fn place_of_environment_of_more_than(&mut self, file: FileId, most: usize) -> Option<u32> {
        let bound = self.bound(file);
        let (mut around, mut declared): (Vec<usize>, Vec<usize>) = (Vec::with_capacity(bound.scopes.len()), vec![0; bound.scopes.len()]);
        for (index, scope) in bound.scopes.iter().enumerate() {
            let is_counted_alone = matches!(scope.kind, crate::bind::ScopeKind::File | crate::bind::ScopeKind::Module(_) | crate::bind::ScopeKind::Fn(_)) || scope.parent.is_none() || scope.parent.idx() >= index;
            around.push(if is_counted_alone { index } else { around[scope.parent.idx()] });
            let is_held_once = matches!(scope.kind, crate::bind::ScopeKind::File | crate::bind::ScopeKind::Module(_));
            declared[around[index]] += if is_held_once { 0 } else { bound.table(scope.locals).len() };
        }
        if declared.iter().all(|&names| names <= most) {
            return None;
        }
        let captures = self.captures_of_file(file);
        let first = captures.environments.iter().filter(|(_, variables)| variables.len() > most).map(|(&activation, _)| activation).min()?;
        let hir = self.hir(file);
        Some(match first {
            Activation::Call(func) | Activation::Expression(func) => hir[func].start,
            Activation::Iteration(statement) | Activation::Block(statement) => hir[statement].start,
            Activation::Class(class) => hir[class].start,
        })
    }

    pub fn has_environment(&mut self, file: FileId, activation: Activation) -> bool {
        self.captures_of_file(file).environments.contains_key(&activation)
    }

    /// `None`: only the code that declares the variable refers to it, or there is one of it for as long as the program runs.
    pub fn captured_variable(&mut self, sym: Sym) -> Option<CapturedVariable> {
        self.captures_of_file(sym.file).variables.get(&sym).copied()
    }

    /// Of a function expression: the environment that keeps its closure, which is made when the expression is first evaluated, and the field.
    pub fn kept_function_expression(&mut self, file: FileId, func: FnId) -> Option<(Activation, u32)> {
        self.captures_of_file(file).kept_expressions.get(&func).copied()
    }

    /// In the order of their fields, which come behind `environment_of`.
    pub fn function_expressions_kept_in(&mut self, file: FileId, activation: Activation) -> Vec<FnId> {
        self.captures_of_file(file).expressions_kept.get(&activation).cloned().unwrap_or_default()
    }

    /// `None`: the function is no declaration, is assigned to, is never used as a value, or is declared once and for all.
    pub fn is_generator_called_through_its_closure(&mut self, file: FileId, callee: ExprId) -> bool {
        self.captures_of_file(file).generators_called_through_closures.contains(&callee)
    }

    pub fn declared_closure(&mut self, file: FileId, func: FnId) -> Option<DeclaredClosure> {
        self.captures_of_file(file).declared_closures.get(&func).copied()
    }

    /// `(a as T) = value`, which the binder does not take for an assignment to `a`.
    pub fn is_stored_to_through_cast(&self, sym: Sym) -> bool {
        self.files.value_declaration(sym).is_some_and(|(file, decl)| {
            let local = self.bound(file).symbol_of_declaration(decl);
            local.is_some() && (self.is_stored_through_casts(file, local) || self.is_stored_through_assertions(file, local))
        })
    }

    /// Whose `this` the arrow function sees.
    pub fn receiver_of_arrow(&mut self, file: FileId, func: FnId) -> Receiver {
        self.captures_of_file(file).receivers.get(&func).copied().unwrap_or(Receiver::None)
    }

    /// The function that the variable holds a closure of whenever it is read, where that closure is made by the activation that declares the
    /// variable: `const f = () => ..`, with nothing ever stored to `f`. Whoever sees the variable sees the same instances of what the
    /// function captures, and can call it with those. Not so for what the initializer of a `for` statement binds: each iteration has a copy
    /// of the variable, and the closure in it is over the bindings of the initializer.
    pub fn callee_with_captures_at_hand(&mut self, sym: Sym) -> Option<FnId> {
        let (file, Decl::Var(pat)) = self.files.value_declaration(sym)? else { return None };
        if file != sym.file {
            return None;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        let PatParent::Var(d) = bound.pat_parent[pat.idx()] else { return None };
        let local = bound.pat_symbol[pat.idx()];
        if hir[d].kind == VarKind::Var || hir[d].flags.contains(Flags::AMBIENT) || self.store_to(file, sym, Decl::Var(pat)).is_some() || self.files.sym(file, local) != sym {
            return None;
        }
        if self.for_statement_binding(file, Decl::Var(pat)).is_some() {
            return None;
        }
        let mut init = hir[d].init;
        while init.is_some()
            && let ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) = hir[init].kind
        {
            init = expr;
        }
        match hir.exprs.get(init.idx())?.kind {
            ExprKind::Fn(func) if !self.has_dead_zone(sym) || self.is_never_captured_uninitialized(sym) => Some(func),
            _ => None,
        }
    }

    // ───────────────────────────── who evaluates what ─────────────────────────────

    fn code_of_fn(&self, file: FileId, func: FnId) -> Code {
        let bound = self.bound(file);
        if self.hir(file)[func].kind == FnKind::Constructor
            && let FnOwner::Member(member) = bound.fns[func.idx()].owner
            && let MemberOwner::Class(class) = bound.member_owner[member.idx()]
        {
            return Code::Constructor(class);
        }
        Code::Function(func)
    }

    /// Who evaluates a direct child of `at`. What a class evaluates when it is itself evaluated, the code around the class does: what it
    /// extends, computed names, the initializers of static fields.
    fn code_at(&self, file: FileId, mut at: Parent) -> Code {
        let (hir, bound) = (self.hir(file), self.bound(file));
        loop {
            at = match at {
                Parent::None | Parent::File => return Code::Module,
                Parent::Expr(e) if e.is_some() => bound.expr_parent[e.idx()],
                Parent::Stmt(s) if s.is_some() => bound.stmt_parent[s.idx()],
                Parent::FnBody(func) => return self.code_of_fn(file, func),
                Parent::ParamDefault(p) => return self.code_of_fn(file, bound.param_fn[p.idx()]),
                Parent::MemberInit(member) if !hir[member].flags.contains(Flags::STATIC) => match bound.member_owner[member.idx()] {
                    MemberOwner::Class(class) => return Code::Constructor(class),
                    _ => self.parent_of_node(file, at),
                },
                _ => self.parent_by_evaluation(file, at),
            };
        }
    }

    /// The innermost scope that a direct child of `at` is in. `None`: that of the module.
    fn scope_at(&self, file: FileId, mut at: Parent) -> Option<Activation> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        loop {
            at = match at {
                Parent::None | Parent::File => return None,
                Parent::Expr(e) if e.is_some() => bound.expr_parent[e.idx()],
                Parent::Stmt(s) if s.is_some() => match hir[s].kind {
                    StmtKind::Block(_) => return Some(Activation::Block(s)),
                    kind if is_loop(&kind) => return Some(Activation::Iteration(s)),
                    _ => bound.stmt_parent[s.idx()],
                },
                Parent::Case(case) => return Some(Activation::Block(bound.case_stmt[case.idx()])),
                Parent::FnBody(func) => return Some(Activation::Call(func)),
                Parent::ParamDefault(p) => return Some(Activation::Call(bound.param_fn[p.idx()])),
                _ => self.parent_by_evaluation(file, at),
            };
        }
    }

    /// The scope around a scope that is entered at most once each time that one is. `None`: a call and an iteration are entered any number
    /// of times.
    fn scope_around(&self, file: FileId, scope: Activation) -> Option<Activation> {
        match scope {
            Activation::Block(stmt) => self.scope_at(file, self.bound(file).stmt_parent[stmt.idx()]),
            Activation::Call(_) | Activation::Iteration(_) | Activation::Class(_) | Activation::Expression(_) => None,
        }
    }

    /// The scope that has its own of what the declaration binds each time it is entered. `holder`: `activation_binding`.
    fn scope_declaring(&self, file: FileId, decl: Decl, holder: Option<FnId>) -> Option<Activation> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let of_function = holder.map(Activation::Call);
        let stmt = match decl {
            Decl::Var(pat) | Decl::Param(pat) | Decl::Require(pat) => match root_declaration(bound, pat) {
                PatParent::Var(d) if hir[d].kind != VarKind::Var => bound.var_stmt[d.idx()],
                _ => return of_function,
            },
            Decl::Fn(func) => match bound.fns[func.idx()].owner {
                FnOwner::Stmt(stmt) => stmt,
                FnOwner::Expr(_) if self.names_its_closure(file, func) => return Some(Activation::Expression(func)),
                _ => return of_function,
            },
            Decl::Class(class) => match bound.class_owner[class.idx()].to_parent() {
                Parent::Stmt(stmt) => stmt,
                _ => return of_function,
            },
            _ => return of_function,
        };
        if stmt.is_none() {
            return of_function;
        }
        // What a `catch` clause binds is as good as declared by its block.
        if let StmtKind::Try { handler, .. } = hir[stmt].kind {
            return Some(Activation::Block(handler));
        }
        self.scope_at(file, bound.stmt_parent[stmt.idx()])
    }

    /// Whether the function expression has a name, which stands for its closure wherever it is read. Nothing can be stored to it: an assignment throws or does nothing, see
    /// `FileBuild::assign_sym`.
    fn names_its_closure(&self, file: FileId, func: FnId) -> bool {
        self.bound(file).fn_symbol[func.idx()].is_some()
    }

    /// Whether a direct child of `at` is evaluated at most once each time the scope is entered: it is in the scope, in no loop and no function
    /// within it.
    fn is_evaluated_once_in(&self, file: FileId, at: Parent, scope: Activation) -> bool {
        let mut around = self.scope_at(file, at);
        while let Some(inner) = around {
            if inner == scope {
                return true;
            }
            around = self.scope_around(file, inner);
        }
        false
    }

    /// Whether a direct child of `at` is within the class, in a member, an initializer or a name.
    fn is_within_class(&self, file: FileId, mut at: Parent, class: ClassId) -> bool {
        let bound = self.bound(file);
        let whole = bound.class_owner[class.idx()].to_parent();
        loop {
            if at == whole {
                return true;
            }
            at = match at {
                Parent::None | Parent::File => return false,
                Parent::Expr(e) if e.is_some() => bound.expr_parent[e.idx()],
                Parent::Stmt(s) if s.is_some() => bound.stmt_parent[s.idx()],
                _ => self.parent_of_node(file, at),
            };
        }
    }

    /// The innermost class that a direct child of `at` is in a member of.
    fn class_around(&self, file: FileId, mut at: Parent) -> Option<ClassId> {
        let bound = self.bound(file);
        loop {
            let member = match at {
                Parent::None | Parent::File => return None,
                Parent::Expr(e) if e.is_some() => {
                    at = bound.expr_parent[e.idx()];
                    continue;
                }
                Parent::Stmt(s) if s.is_some() => {
                    at = bound.stmt_parent[s.idx()];
                    continue;
                }
                Parent::MemberInit(member) => Some(member),
                Parent::FnBody(func) => match bound.fns[func.idx()].owner {
                    FnOwner::Member(member) => Some(member),
                    _ => None,
                },
                _ => None,
            };
            if let Some(member) = member
                && let MemberOwner::Class(class) = bound.member_owner[member.idx()]
            {
                return Some(class);
            }
            at = self.parent_by_evaluation(file, at);
        }
    }

    fn receiver_at(&self, file: FileId, mut at: Parent) -> Receiver {
        let (hir, bound) = (self.hir(file), self.bound(file));
        loop {
            let func = match at {
                Parent::None | Parent::File => return Receiver::None,
                Parent::Expr(e) if e.is_some() => {
                    at = bound.expr_parent[e.idx()];
                    continue;
                }
                Parent::Stmt(s) if s.is_some() => {
                    at = bound.stmt_parent[s.idx()];
                    continue;
                }
                Parent::MemberInit(member) => match bound.member_owner[member.idx()] {
                    MemberOwner::Class(class) if hir[member].flags.contains(Flags::STATIC) => return Receiver::Static(class),
                    MemberOwner::Class(class) => return Receiver::Instance(class),
                    _ => FnId::NONE,
                },
                Parent::FnBody(func) => func,
                Parent::ParamDefault(p) => bound.param_fn[p.idx()],
                _ => FnId::NONE,
            };
            if func.is_some() && hir[func].kind != FnKind::Arrow {
                return Receiver::Function(func);
            }
            at = self.parent_by_evaluation(file, at);
        }
    }

    fn is_created_within_class(&self, file: FileId, func: FnId, class: ClassId) -> bool {
        let bound = self.bound(file);
        matches!(bound.fns[func.idx()].owner, FnOwner::Expr(made) if self.is_within_class(file, bound.expr_parent[made.idx()], class))
    }

    fn is_class_evaluated_once(&self, file: FileId, class: ClassId) -> bool {
        self.is_evaluated_once(file, self.bound(file).class_owner[class.idx()].to_parent()) && !self.is_class_named_by_computed_key(file, class)
    }

    // ───────────────────────────── which variables are copied ─────────────────────────────

    /// The `for` statement whose initializer declares the `let` or `const`, and the initializer.
    fn for_statement_binding(&self, file: FileId, decl: Decl) -> Option<(StmtId, StmtId)> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let Decl::Var(pat) = decl else { return None };
        let PatParent::Var(d) = root_declaration(bound, pat) else { return None };
        let declaring = bound.var_stmt[d.idx()];
        if declaring.is_none() || hir[d].kind == VarKind::Var {
            return None;
        }
        match bound.stmt_parent[declaring.idx()] {
            Parent::Stmt(outer) if outer.is_some() && matches!(hir[outer].kind, StmtKind::For { init, .. } if init == declaring) => Some((outer, declaring)),
            _ => None,
        }
    }

    /// The loop that binds the `let` or `const`, and where in the text that part of it is which is evaluated before the first iteration: the
    /// initializer of a `for` statement, what a `for-in` or `for-of` statement iterates over.
    fn loop_binding(&self, file: FileId, decl: Decl) -> Option<(StmtId, std::ops::Range<u32>)> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if let Some((statement, initializer)) = self.for_statement_binding(file, decl) {
            return Some((statement, hir[initializer].start..hir[initializer].loc.end));
        }
        let Decl::Var(pat) = decl else { return None };
        let PatParent::Var(d) = root_declaration(bound, pat) else { return None };
        let declaring = bound.var_stmt[d.idx()];
        if declaring.is_none() || hir[d].kind == VarKind::Var {
            return None;
        }
        match bound.stmt_parent[declaring.idx()] {
            Parent::Stmt(outer) if outer.is_some() => match hir[outer].kind {
                StmtKind::ForIn { left, expr, .. } | StmtKind::ForOf { left, expr, .. } if left == declaring => Some((outer, hir[expr].pos..hir[expr].end)),
                _ => None,
            },
            _ => None,
        }
    }

    /// A store to the variable other than the one that binds it. The `update` of the `for` statement that declares it stores to the
    /// binding of the next iteration, which nothing has seen yet.
    fn store_to(&self, file: FileId, sym: Sym, decl: Decl) -> Option<NotCopied> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let local = bound.symbol_of_declaration(decl);
        let symbol = bound.symbols.get(local.idx())?;
        if symbol.flags.contains(SymFlags::MERGED) || symbol.decls.as_slice().len() != 1 || self.files.sym(file, local) != sym {
            return Some(NotCopied::Declaration);
        }
        if self.is_stored_through_casts(file, local) || self.is_stored_through_assertions(file, local) {
            return Some(NotCopied::StoredThroughCast);
        }
        let update = match decl {
            Decl::Var(pat) => match root_declaration(bound, pat) {
                PatParent::Var(d) if bound.var_stmt[d.idx()].is_some() => match bound.stmt_parent[bound.var_stmt[d.idx()].idx()] {
                    Parent::Stmt(outer) if outer.is_some() => match hir[outer].kind {
                        StmtKind::For { init, update, .. } if init == bound.var_stmt[d.idx()] => update,
                        _ => ExprId::NONE,
                    },
                    _ => ExprId::NONE,
                },
                _ => ExprId::NONE,
            },
            _ => ExprId::NONE,
        };
        let holder = self.code_at(file, bound.expr_parent.get(update.idx()).copied().unwrap_or(Parent::None));
        let is_in_update = |target: ExprId| {
            update.is_some() && hir[update].pos <= hir[target].pos && hir[target].end <= hir[update].end && self.code_at(file, bound.expr_parent[target.idx()]) == holder
        };
        bound.assignments_to(local).iter().map(|&(_, target)| target).find(|&target| !is_in_update(target)).map(NotCopied::Stored)
    }

    /// Whether the inner function that the reference `e` to the parameter is in is made once the parameter is bound: in the body of the function,
    /// or in a parameter further to the right. Parameters are bound from left to right, before the body runs.
    fn is_created_after_parameter(&self, file: FileId, pat: PatId, e: ExprId) -> bool {
        let bound = self.bound(file);
        let PatParent::Param(declared) = root_declaration(bound, pat) else { return false };
        let func = bound.param_fn[declared.idx()];
        let mut at = bound.expr_parent[e.idx()];
        loop {
            at = match at {
                Parent::None | Parent::File => return false,
                Parent::FnBody(body) if body == func => return true,
                Parent::ParamDefault(p) if bound.param_fn[p.idx()] == func => return p > declared,
                Parent::Expr(e) if e.is_some() => bound.expr_parent[e.idx()],
                Parent::Stmt(s) if s.is_some() => bound.stmt_parent[s.idx()],
                _ => self.parent_of_node(file, at),
            };
        }
    }

    /// Whether the expression is evaluated only once control has passed the position `end` in the text of `site`: it comes later in that code, or
    /// is part of a function or a class that is made later in that code, or of a function declaration that is only mentioned, to call it
    /// or as a value, by what is itself evaluated that late. `mentions`: by function declaration. `looked_at`: a declaration that is
    /// mentioned by itself, by way of others or not, does not run for that. `closures`: a declaration whose closure is made where its scope is
    /// entered has its captures read there, ahead of the variable, whenever it is mentioned.
    fn is_evaluated_once_bound(
        &self,
        file: FileId,
        e: ExprId,
        site: Site,
        end: u32,
        mentions: &FxHashMap<FnId, Vec<ExprId>>,
        closures: &FxHashMap<FnId, DeclaredClosure>,
        looked_at: &mut FxHashSet<FnId>,
    ) -> bool {
        let bound = self.bound(file);
        let (mut pos, mut parent) = (self.hir(file)[e].pos, bound.expr_parent[e.idx()]);
        loop {
            let at = match self.site_of(file, parent) {
                Some(at) if at == site => return pos >= end,
                Some(at) => at,
                None => return false,
            };
            if let Some(made) = self.where_created(file, at) {
                (pos, parent) = made;
                continue;
            }
            let func = match at {
                Site::Body(func) => func,
                Site::Parameter(p) => bound.param_fn[p.idx()],
                Site::File | Site::Initializer(_) => return false,
            };
            if !matches!(bound.fns[func.idx()].owner, FnOwner::Stmt(_)) || matches!(closures.get(&func), Some(DeclaredClosure::CreatedAtEntry)) || self.is_declared_over_parameter(file, func) {
                return false;
            }
            // A name that is stored to is a variable, which is given the closure where the scope is entered. Its mentions are not listed.
            let name = bound.fn_symbol[func.idx()];
            if name.is_none() || bound.symbols[name.idx()].flags.contains(SymFlags::ASSIGNED) || !bound.assignments_to(name).is_empty() || self.is_stored_through_casts(file, name) {
                return false;
            }
            if bound.symbols[name.idx()].decls.iter().any(|decl| matches!(decl, Decl::Var(_) | Decl::Param(_))) {
                return false;
            }
            return !looked_at.insert(func) || mentions.get(&func).is_none_or(|by| by.iter().all(|&mention| self.is_evaluated_once_bound(file, mention, site, end, mentions, closures, looked_at)));
        }
    }

    fn is_declared_over_parameter(&self, file: FileId, func: FnId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let FnOwner::Stmt(stmt) = bound.fns[func.idx()].owner else { return false };
        let Parent::FnBody(around) = bound.stmt_parent[stmt.idx()] else { return false };
        hir[around].params.iter().any(|p| self.binds_name(file, hir[p].pat, hir[func].name))
    }

    fn binds_name(&self, file: FileId, pat: PatId, name: Atom) -> bool {
        let hir = self.hir(file);
        match hir[pat].kind {
            crate::hir::PatKind::Missing => false,
            crate::hir::PatKind::Ident(bound) => bound == name,
            crate::hir::PatKind::Object(props) => props.iter().any(|p| self.binds_name(file, hir[p].value, name)),
            crate::hir::PatKind::Array(elements) => elements.iter().any(|e| self.binds_name(file, hir[e].pat, name)),
        }
    }

    fn is_created_after_statement(&self, file: FileId, stmt: StmtId, e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let Parent::FnBody(func) = bound.stmt_parent[stmt.idx()] else { return false };
        let (mut at, mut outermost) = (bound.expr_parent[e.idx()], FnId::NONE);
        loop {
            at = match at {
                Parent::None | Parent::File => return false,
                Parent::FnBody(body) if body == func => break,
                Parent::ParamDefault(p) if bound.param_fn[p.idx()] == func => return false,
                Parent::FnBody(inner) => {
                    outermost = inner;
                    self.parent_of_node(file, at)
                }
                Parent::ParamDefault(p) => {
                    outermost = bound.param_fn[p.idx()];
                    self.parent_of_node(file, at)
                }
                Parent::Expr(e) if e.is_some() => bound.expr_parent[e.idx()],
                Parent::Stmt(s) if s.is_some() => bound.stmt_parent[s.idx()],
                _ => self.parent_by_evaluation(file, at),
            };
        }
        outermost.is_some() && matches!(bound.fns[outermost.idx()].owner, FnOwner::Expr(made) if hir[made].pos >= hir[stmt].loc.end)
    }

    /// `references`: those to the variable from code other than the code that declares it.
    fn why_not_copied(&mut self, file: FileId, sym: Sym, decl: Decl, references: &[ExprId]) -> Option<NotCopied> {
        if let Some(stored) = self.store_to(file, sym, decl) {
            return Some(stored);
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        match decl {
            Decl::Param(pat) => references.iter().copied().find(|&e| !self.is_created_after_parameter(file, pat, e)).map(NotCopied::SeenEarly),
            Decl::Class(_) => (!self.is_never_captured_uninitialized(sym)).then(|| NotCopied::SeenEarly(references[0])),
            Decl::Var(pat) => {
                let PatParent::Var(d) = root_declaration(bound, pat) else { return Some(NotCopied::Declaration) };
                let stmt = bound.var_stmt[d.idx()];
                if hir[d].kind == VarKind::Var && stmt.is_some() && hir[d].init.is_some() && !hir.is_js && !self.has_direct_eval(file) {
                    return references.iter().any(|&e| !self.is_created_after_statement(file, stmt, e)).then_some(NotCopied::Declaration);
                }
                if !matches!(hir[d].kind, VarKind::Let | VarKind::Const) || stmt.is_none() {
                    return Some(NotCopied::Declaration);
                }
                // What is bound before the statement runs that alone can refer to it.
                let bound_before = match (hir[stmt].kind, bound.stmt_parent[stmt.idx()]) {
                    (StmtKind::Try { handler, .. }, _) => handler,
                    (_, Parent::Stmt(outer)) if outer.is_some() => match hir[outer].kind {
                        StmtKind::ForIn { left, body, .. } | StmtKind::ForOf { left, body, .. } if left == stmt => body,
                        StmtKind::For { init, body, .. } if init == stmt => body,
                        _ => StmtId::NONE,
                    },
                    _ => StmtId::NONE,
                };
                if bound_before.is_some() {
                    let within = hir[bound_before].start..hir[bound_before].loc.end;
                    return references.iter().copied().find(|&e| !within.contains(&hir[e].pos)).map(NotCopied::OutsideBody);
                }
                (!self.is_never_captured_uninitialized(sym)).then(|| NotCopied::SeenEarly(references[0]))
            }
            _ => Some(NotCopied::Declaration),
        }
    }

    // ───────────────────────────── the pass over a file ─────────────────────────────

    fn find_captures_of_file(&mut self, file: FileId) -> FileCaptures {
        let index = self.exprs_by_kind_of(file);
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut found = FileCaptures::default();
        let mut raw: FxHashMap<Node, FxHashSet<Need>> = FxHashMap::default();
        let mut edges: FxHashSet<(Node, Node)> = FxHashSet::default();

        // What is referred to by name.
        let mut references: Vec<Reference> = Vec::new();
        for &e in index.of(ExprTag::Ident) {
            let ExprKind::Ident(name) = hir[e].kind else { continue };
            let parent = bound.expr_parent[e.idx()];
            if parent == Parent::None || bound.is_in_type_query(e) {
                continue;
            }
            if bound.is_arguments_object(e) {
                if let (Code::Function(inner), Receiver::Function(func)) = (self.code_at(file, parent), self.receiver_at(file, parent))
                    && inner != func
                {
                    raw.entry(Node::Code(Code::Function(inner))).or_default().insert(Need::Arguments(func));
                }
                continue;
            }
            // What another file declares, which may take types to find, is of no interest here.
            let resolved = self.resolve_identifier(file, e, name, true).ok().flatten();
            let Some(sym) = resolved else { continue };
            let Some((declared_in, decl)) = self.declaration_of_variable(sym) else { continue };
            if declared_in != file {
                continue;
            }
            let Some(holder) = self.activation_binding(file, decl) else { continue };
            let holder = holder.map_or(Code::Module, |func| self.code_of_fn(file, func));
            let sym = self.files.sym(file, bound.symbol_of_declaration(decl));
            references.push(Reference { e, sym, decl, code: self.code_at(file, parent), holder });
        }

        // A function declaration that nothing is stored to stands for its function.
        let declared_function = |this: &Self, reference: &Reference| -> Option<FnId> {
            let Decl::Fn(declared) = reference.decl else { return None };
            let symbol = &bound.symbols[reference.sym.id.idx()];
            let is_own_name = matches!(bound.fns[declared.idx()].owner, FnOwner::Expr(_));
            let is_variable = symbol.decls.iter().any(|decl| matches!(decl, Decl::Var(_) | Decl::Param(_)));
            if !is_own_name && (is_variable || symbol.flags.contains(SymFlags::ASSIGNED) || !bound.assignments_to(reference.sym.id).is_empty() || this.is_stored_through_casts(file, reference.sym.id)) {
                return None;
            }
            // Of an overloaded function, the declaration with the body. Of several, the last, which is what the name stands for.
            let with_body = |decl: &Decl| matches!(*decl, Decl::Fn(func) if !matches!(hir[func].body, FnBody::None));
            match symbol.decls.as_slice().iter().rfind(|decl| with_body(decl)) {
                Some(&Decl::Fn(func)) => Some(func),
                _ => None,
            }
        };
        let is_called_directly = |e: ExprId| match bound.expr_parent[e.idx()] {
            Parent::Expr(parent) => match hir[parent].kind {
                ExprKind::Call(call) => hir[call].callee == e && hir[call].chain == Chain::No && !hir.ids(hir[call].args).any(|argument| matches!(hir[argument].kind, ExprKind::Spread(_))),
                _ => false,
            },
            _ => false,
        };
        // A function expression whose own name is used as a value may capture the scope of that name, which nobody but itself has at hand.
        let atoms = self.atoms();
        let returns_a_generator = |func: FnId, e: ExprId| {
            hir[func].flags.contains(Flags::GENERATOR)
                && match bound.expr_parent[e.idx()] {
                    Parent::Expr(call) => match bound.expr_parent[call.idx()] {
                        Parent::Stmt(s) => !matches!(hir[s].kind, StmtKind::ForOf { expr, is_await: false, .. } if expr == call),
                        Parent::Expr(dot) => {
                            !(matches!(hir[dot].kind, ExprKind::Dot { obj, name, chain: Chain::No, .. } if obj == call && matches!(atoms.bytes(name), b"next" | b"return" | b"throw"))
                                && matches!(bound.expr_parent[dot.idx()], Parent::Expr(step) if matches!(hir[step].kind, ExprKind::Call(stepped) if hir[stepped].callee == dot && hir[stepped].chain == Chain::No)))
                        }
                        _ => true,
                    },
                    _ => false,
                }
        };
        let is_callee = |e: ExprId| matches!(bound.expr_parent[e.idx()], Parent::Expr(parent) if matches!(hir[parent].kind, ExprKind::Call(call) if hir[call].callee == e && hir[call].chain == Chain::No));
        let mut through_closures: FxHashSet<ExprId> = FxHashSet::default();
        let mut names_itself: FxHashSet<FnId> = (references.iter())
            .filter_map(|reference| declared_function(self, reference).filter(|&func| !is_called_directly(reference.e) || returns_a_generator(func, reference.e)))
            .filter(|func| matches!(bound.fns[func.idx()].owner, FnOwner::Expr(_)))
            .collect();
        // So may one whose `arguments` object shows it: `arguments.callee`.
        let mapped = self.mapped_arguments_of_file(file);
        let mut showing_themselves: Vec<FnId> = mapped.functions.keys().copied().collect();
        showing_themselves.sort_unstable();
        names_itself.extend(showing_themselves.iter().copied().filter(|func| matches!(bound.fns[func.idx()].owner, FnOwner::Expr(_))));
        let mut captured: FxHashMap<Sym, (Decl, Vec<ExprId>)> = FxHashMap::default();
        let mut uses_as_value: FxHashMap<FnId, Vec<(ExprId, Code, Code)>> = FxHashMap::default();
        let mut symbol_of_function: FxHashMap<FnId, (Sym, Decl)> = FxHashMap::default();
        let mut mentions: FxHashMap<FnId, Vec<ExprId>> = FxHashMap::default();
        for reference in &references {
            let node = Node::Code(reference.code);
            // It lives in the `arguments` object of its function.
            if let Some((owner, _)) = self.mapped_parameter(reference.sym) {
                if reference.code != reference.holder {
                    raw.entry(node).or_default().insert(Need::Arguments(owner));
                }
                continue;
            }
            if let Decl::Class(class) = reference.decl
                && !self.is_class_evaluated_once(file, class)
                && self.is_within_class(file, bound.expr_parent[reference.e.idx()], class)
            {
                if reference.code != reference.holder {
                    raw.entry(node).or_default().insert(Need::Class(class));
                }
                continue;
            }
            if let Some(func) = declared_function(self, reference) {
                edges.insert((node, Node::Code(self.code_of_fn(file, func))));
                mentions.entry(func).or_default().push(reference.e);
                // The name of a function expression within it stands for the closure that the evaluation of the expression made.
                if (!is_called_directly(reference.e) || returns_a_generator(func, reference.e)) && matches!(bound.fns[func.idx()].owner, FnOwner::Stmt(_) | FnOwner::Expr(_)) {
                    if is_callee(reference.e) && returns_a_generator(func, reference.e) {
                        through_closures.insert(reference.e);
                    }
                    uses_as_value.entry(func).or_default().push((reference.e, reference.code, reference.holder));
                    symbol_of_function.insert(func, (reference.sym, reference.decl));
                    if reference.code != reference.holder {
                        raw.entry(node).or_default().insert(Need::Closure(func));
                    }
                }
                continue;
            }
            // Whoever calls it needs what it captures, and not its closure.
            if is_called_directly(reference.e)
                && let Some(func) = self.callee_with_captures_at_hand(reference.sym)
                && !names_itself.contains(&func)
            {
                if !returns_a_generator(func, reference.e) {
                    edges.insert((node, Node::Code(Code::Function(func))));
                    continue;
                }
                through_closures.insert(reference.e);
            }
            if reference.code != reference.holder {
                raw.entry(node).or_default().insert(Need::Variable(reference.sym));
                captured.entry(reference.sym).or_insert((reference.decl, Vec::new())).1.push(reference.e);
            }
        }

        // The `arguments` object of a declaration shows its closure: as good as its name used as a value within it.
        for &func in &showing_themselves {
            let name = bound.fn_symbol[func.idx()];
            if !matches!(bound.fns[func.idx()].owner, FnOwner::Stmt(_))
                || name.is_none()
                || bound.symbols[name.idx()].flags.contains(SymFlags::ASSIGNED)
                || !bound.assignments_to(name).is_empty()
                || self.is_stored_through_casts(file, name)
            {
                continue;
            }
            let Some(holder) = self.activation_binding(file, Decl::Fn(func)) else { continue };
            let holder = holder.map_or(Code::Module, |around| self.code_of_fn(file, around));
            let code = self.code_of_fn(file, func);
            uses_as_value.entry(func).or_default().push((mapped.functions[&func], code, holder));
            symbol_of_function.insert(func, (self.files.sym(file, name), Decl::Fn(func)));
            raw.entry(Node::Code(code)).or_default().insert(Need::Closure(func));
        }

        // `this`, `super`, `#name`.
        for &e in index.of(ExprTag::This) {
            let parent = bound.expr_parent[e.idx()];
            let Code::Function(func) = self.code_at(file, parent) else { continue };
            if hir[func].kind != FnKind::Arrow {
                continue;
            }
            match self.receiver_at(file, parent) {
                Receiver::None => {}
                Receiver::Static(class) if self.is_class_evaluated_once(file, class) || !self.is_created_within_class(file, func, class) => {}
                Receiver::Static(class) => {
                    raw.entry(Node::Code(Code::Function(func))).or_default().insert(Need::Class(class));
                }
                receiver => {
                    raw.entry(Node::Code(Code::Function(func))).or_default().insert(Need::This(receiver));
                }
            }
        }
        for &e in index.of(ExprTag::Super) {
            let parent = bound.expr_parent[e.idx()];
            let code = self.code_at(file, parent);
            let method_of_literal = match self.receiver_at(file, parent) {
                Receiver::Function(func) if matches!(hir[func].kind, FnKind::Method | FnKind::Getter | FnKind::Setter) && matches!(bound.fns[func.idx()].owner, FnOwner::Expr(_)) => Some(func),
                _ => None,
            };
            if let Some(method) = method_of_literal {
                raw.entry(Node::Code(code)).or_default().insert(Need::HomeObject(method));
            } else if let Some(class) = self.class_around(file, parent).filter(|&class| !matches!(code, Code::Function(func) if hir[func].kind == FnKind::Arrow && !self.is_created_within_class(file, func, class))) {
                raw.entry(Node::Code(code)).or_default().insert(Need::Class(class));
            }
            // `super.m()` passes `this`.
            if let Code::Function(func) = code
                && hir[func].kind == FnKind::Arrow
            {
                match self.receiver_at(file, parent) {
                    Receiver::None => {}
                    Receiver::Static(class) if !self.is_created_within_class(file, func, class) => {}
                    Receiver::Static(class) => {
                        raw.entry(Node::Code(code)).or_default().insert(Need::Class(class));
                    }
                    receiver => {
                        raw.entry(Node::Code(code)).or_default().insert(Need::This(receiver));
                    }
                }
            }
        }
        for &e in index.of(ExprTag::NewTarget) {
            let parent = bound.expr_parent[e.idx()];
            if let Code::Function(func) = self.code_at(file, parent)
                && hir[func].kind == FnKind::Arrow
                && let Receiver::Function(owner) = self.receiver_at(file, parent)
            {
                raw.entry(Node::Code(Code::Function(func))).or_default().insert(Need::NewTarget(owner));
            }
        }
        let mut private_names: Vec<(ExprId, ClassId)> = bound.private_class.iter().map(|(&e, &class)| (e, class)).collect();
        private_names.sort_unstable();
        for (e, class) in private_names {
            raw.entry(Node::Code(self.code_at(file, bound.expr_parent[e.idx()]))).or_default().insert(Need::Class(class));
        }

        // Who makes what.
        for &e in index.of(ExprTag::Fn) {
            let ExprKind::Fn(func) = hir[e].kind else { continue };
            let parent = bound.expr_parent[e.idx()];
            if parent == Parent::None {
                continue;
            }
            edges.insert((Node::Code(self.code_at(file, parent)), Node::Code(Code::Function(func))));
            if hir[func].kind == FnKind::Arrow {
                found.receivers.insert(func, self.receiver_at(file, parent));
            }
        }
        for i in 0..bound.fns.len() {
            let func = FnId(i as u32);
            let FnOwner::Stmt(stmt) = bound.fns[i].owner else { continue };
            let name = bound.fn_symbol[i];
            if name.is_none() || matches!(hir[func].body, FnBody::None) {
                continue;
            }
            let symbol = &bound.symbols[name.idx()];
            let is_variable = symbol.decls.iter().any(|decl| matches!(decl, Decl::Var(_) | Decl::Param(_)));
            if is_variable || symbol.flags.contains(SymFlags::ASSIGNED) || !bound.assignments_to(name).is_empty() || self.is_stored_through_casts(file, name) {
                edges.insert((Node::Code(self.code_at(file, bound.stmt_parent[stmt.idx()])), Node::Code(self.code_of_fn(file, func))));
            }
        }
        let mut classes: Vec<ClassId> = Vec::new();
        for i in 0..bound.class_owner.len() {
            let class = ClassId(i as u32);
            if hir[class].flags.contains(Flags::AMBIENT) || self.is_class_evaluated_once(file, class) {
                continue;
            }
            classes.push(class);
            edges.insert((Node::Code(self.code_at(file, bound.class_owner[i].to_parent())), Node::Class(class)));
            edges.insert((Node::Class(class), Node::Code(Code::Constructor(class))));
            let keeps_names = |member: MemberId| !hir[member].flags.contains(Flags::STATIC) && matches!(hir[member].key, PropKey::Computed(_) | PropKey::Private(_));
            if hir[class].extends.is_some() || hir[class].members.iter().any(keeps_names) {
                raw.entry(Node::Code(Code::Constructor(class))).or_default().insert(Need::Class(class));
            }
            for member in hir[class].members.iter() {
                let func = hir[member].func;
                if func.is_some() && !matches!(hir[func].body, FnBody::None) {
                    edges.insert((Node::Class(class), Node::Code(self.code_of_fn(file, func))));
                }
            }
        }

        // Where the closures of function declarations are kept.
        let mut kept: FxHashMap<Activation, Vec<(Sym, FnId, ExprId)>> = FxHashMap::default();
        let mut kept_if_environment_exists: Vec<(Activation, Sym, FnId, ExprId)> = Vec::new();
        found.generators_called_through_closures = through_closures;
        let mut functions: Vec<FnId> = uses_as_value.keys().copied().collect();
        functions.sort_unstable();
        for func in functions {
            let (sym, decl) = symbol_of_function[&func];
            let Some(holder) = self.activation_binding(file, decl) else { continue };
            let Some(activation) = self.scope_declaring(file, decl, holder) else { continue };
            let uses = &uses_as_value[&func];
            if !mapped.functions.contains_key(&func) && !self.hir(file)[func].flags.contains(Flags::GENERATOR) && uses.iter().all(|used| self.use_of_value(file, used.0) & argument_use::OBSERVED == 0) {
                found.declared_closures.insert(func, DeclaredClosure::Unobserved);
                if let Activation::Call(outermost) = activation
                    && bound.fns[outermost.idx()].enclosing.is_none()
                    && let Some(&(inner, ..)) = uses.iter().find(|used| used.1 != used.2)
                {
                    kept_if_environment_exists.push((activation, sym, func, inner));
                }
            } else if let Some(&(inner, ..)) = uses.iter().find(|used| used.1 != used.2) {
                kept.entry(activation).or_default().push((sym, func, inner));
            } else if let [(only, ..)] = uses[..]
                && self.is_evaluated_once_in(file, bound.expr_parent[only.idx()], activation)
            {
                found.declared_closures.insert(func, DeclaredClosure::CreatedAtUse);
            } else {
                found.declared_closures.insert(func, DeclaredClosure::CreatedAtEntry);
            }
        }

        // Which scopes need an environment: one with a variable that is not copied, or with too many.
        let mut by_activation: FxHashMap<Activation, Vec<Sym>> = FxHashMap::default();
        let mut variables: Vec<Sym> = captured.keys().copied().collect();
        variables.sort_unstable();
        for sym in variables {
            let (decl, inner) = &captured[&sym];
            let Some(activation) = self.activation_binding(file, *decl).and_then(|holder| self.scope_declaring(file, *decl, holder)) else { continue };
            by_activation.entry(activation).or_default().push(sym);
            if let Some((statement, ahead)) = self.loop_binding(file, *decl)
                && inner.iter().any(|&e| ahead.contains(&hir[e].pos))
            {
                found.captured_before_iterations.insert(statement);
            }
            if let Some(why) = self.why_not_copied(file, sym, *decl, inner) {
                found.not_copied.insert(sym, why);
            }
        }
        for (&activation, closures) in &kept {
            for &(sym, _, inner) in closures {
                by_activation.entry(activation).or_default().push(sym);
                found.not_copied.insert(sym, NotCopied::KeepsClosure(inner));
            }
        }
        // A scope that is held back by nothing else: whether what is seen early is seen by a function declaration that nothing mentions before
        // the variable is bound.
        for held in by_activation.values().filter(|held| held.len() <= MOST_COPIES) {
            if !held.iter().all(|sym| matches!(found.not_copied.get(sym), None | Some(NotCopied::SeenEarly(_)))) {
                continue;
            }
            for sym in held {
                let Some((decl @ (Decl::Var(_) | Decl::Class(_)), inner)) = captured.get(sym) else { continue };
                if found.not_copied.contains_key(sym)
                    && let Some((site, end)) = self.dead_zone_of(file, *decl)
                    && inner.iter().all(|&e| self.is_evaluated_once_bound(file, e, site, end, &mentions, &found.declared_closures, &mut FxHashSet::default()))
                {
                    found.not_copied.remove(sym);
                }
            }
        }
        for (activation, sym, func, inner) in kept_if_environment_exists {
            if by_activation.get(&activation).is_some_and(|held| held.len() > MOST_COPIES || held.iter().any(|sym| found.not_copied.contains_key(sym))) {
                found.declared_closures.remove(&func);
                kept.entry(activation).or_default().push((sym, func, inner));
                by_activation.entry(activation).or_default().push(sym);
                found.not_copied.insert(sym, NotCopied::KeepsClosure(inner));
            }
        }
        let mut by_root: FxHashMap<Activation, Vec<Sym>> = FxHashMap::default();
        let is_bound_to_literal = |sym: &Sym| {
            let Some((Decl::Var(pat), _)) = captured.get(sym) else { return false };
            let PatParent::Var(d) = bound.pat_parent[pat.idx()] else { return false };
            let mut init = hir[d].init;
            while init.is_some()
                && let ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) = hir[init].kind
            {
                init = expr;
            }
            init.is_some() && matches!(hir[init].kind, ExprKind::Object(_))
        };
        let lives_in_environment = |held: &[Sym], sym: &Sym| {
            (held.len() > MOST_COPIES || held.iter().any(|sym| found.not_copied.contains_key(sym))) && (found.not_copied.contains_key(sym) || !is_bound_to_literal(sym))
        };
        let needs_environment = |held: &[Sym]| held.iter().any(|sym| lives_in_environment(held, sym));
        for (&scope, held) in &by_activation {
            if !needs_environment(held) {
                continue;
            }
            // It shares the environment of the outermost scope around it that needs one and that it is entered at most once with.
            let (mut root, mut around) = (scope, self.scope_around(file, scope));
            while let Some(outer) = around {
                if by_activation.get(&outer).is_some_and(|held| needs_environment(held)) {
                    root = outer;
                }
                around = self.scope_around(file, outer);
            }
            by_root.entry(root).or_default().extend(held.iter().filter(|sym| lives_in_environment(held, sym)));
        }
        for held in by_activation.values() {
            for &sym in held.iter().filter(|sym| !lives_in_environment(held, sym)) {
                found.variables.insert(sym, CapturedVariable::Copied);
            }
        }
        let kept: Vec<(Sym, FnId)> = kept.into_values().flatten().map(|(sym, func, _)| (sym, func)).collect();
        for (activation, mut held) in by_root {
            held.sort_unstable();
            for (i, &sym) in held.iter().enumerate() {
                found.variables.insert(sym, CapturedVariable::InEnvironment(activation, i as u32));
            }
            found.environments.insert(activation, held);
        }
        for (sym, func) in kept {
            if let Some(&CapturedVariable::InEnvironment(activation, index)) = found.variables.get(&sym) {
                found.declared_closures.insert(func, DeclaredClosure::KeptInEnvironment(activation, index));
            }
        }
        // A function expression whose `arguments` object shows it finds its closure in a scope of its own, as one that names itself does. Without a name there is no variable in it.
        // So does a declaration whose name is stored to: the name is a variable, which is given the closure where its scope is entered and may hold anything later.
        for &func in &showing_themselves {
            let name = bound.fn_symbol[func.idx()];
            let has_own_scope = match bound.fns[func.idx()].owner {
                FnOwner::Expr(_) => true,
                FnOwner::Stmt(_) => {
                    name.is_some() && (bound.symbols[name.idx()].flags.contains(SymFlags::ASSIGNED) || !bound.assignments_to(name).is_empty() || self.is_stored_through_casts(file, name))
                }
                _ => false,
            };
            if !has_own_scope {
                continue;
            }
            let activation = Activation::Expression(func);
            if !matches!(found.declared_closures.get(&func), Some(DeclaredClosure::KeptInEnvironment(..))) {
                found.environments.insert(activation, Vec::new());
                found.expressions_kept.insert(activation, vec![func]);
                found.kept_expressions.insert(func, (activation, 0));
            }
            raw.entry(Node::Code(self.code_of_fn(file, func))).or_default().insert(Need::Environment(activation, Sym { file, id: name }));
            if name.is_some() && matches!(bound.fns[func.idx()].owner, FnOwner::Expr(_)) && self.activation_binding(file, Decl::Fn(func)).is_none() {
                for &mention in index.of(ExprTag::Ident) {
                    let parent = bound.expr_parent[mention.idx()];
                    if bound.expr_symbol[mention.idx()] == name && parent != Parent::None && !bound.is_in_type_query(mention) {
                        raw.entry(Node::Code(self.code_at(file, parent))).or_default().insert(Need::Environment(activation, Sym { file, id: name }));
                    }
                }
            }
        }

        // From here on a variable that lives in an environment stands for that: the sets stay small however many variables a scope has.
        for needed in raw.values_mut() {
            *needed = (needed.iter())
                .filter_map(|&need| match need {
                    Need::Variable(sym) => match found.variables.get(&sym)? {
                        CapturedVariable::Copied => Some(need),
                        &CapturedVariable::InEnvironment(activation, _) => Some(Need::Environment(activation, found.environments[&activation][0])),
                    },
                    Need::Closure(func) => match found.declared_closures.get(&func)? {
                        &DeclaredClosure::KeptInEnvironment(activation, _) => Some(Need::Environment(activation, found.environments[&activation][0])),
                        _ => None,
                    },
                    _ => Some(need),
                })
                .collect();
        }

        // Whose activation has what is needed.
        let owner_of = |this: &Self, need: Need| -> Code {
            match need {
                // Whoever evaluates the expression: the initializer of a field is run by the constructor.
                Need::Environment(Activation::Expression(func), _) => this.code_at(file, this.parent_of_node(file, Parent::FnBody(func))),
                Need::Variable(sym) | Need::Environment(_, sym) => {
                    let decl = captured.get(&sym).map(|it| it.0).or_else(|| symbol_of_function.values().find(|it| it.0 == sym).map(|it| it.1));
                    decl.and_then(|decl| this.activation_binding(file, decl)).flatten().map_or(Code::Module, |func| this.code_of_fn(file, func))
                }
                Need::Closure(func) | Need::HomeObject(func) => this.code_at(file, this.parent_of_node(file, Parent::FnBody(func))),
                Need::This(Receiver::Function(func)) | Need::Arguments(func) | Need::NewTarget(func) => this.code_of_fn(file, func),
                Need::This(Receiver::Instance(class)) => Code::Constructor(class),
                Need::This(Receiver::Static(class)) | Need::Class(class) => this.code_at(file, bound.class_owner[class.idx()].to_parent()),
                Need::This(Receiver::None) => Code::Module,
            }
        };
        let member_of: FxHashMap<Code, ClassId> = (classes.iter())
            .flat_map(|&class| {
                let members = hir[class].members.iter().map(|member| hir[member].func).filter(|func| func.is_some()).map(|func| self.code_of_fn(file, func));
                members.chain([Code::Constructor(class)]).map(move |code| (code, class)).collect::<Vec<_>>()
            })
            .collect();

        // The least sets such that each node needs what it refers to and what the nodes it makes or calls need, but for what it has itself.
        // All that gets out of a member of a class is a need for the class.
        let mut edges: Vec<(Node, Node)> = edges.into_iter().filter(|edge| edge.0 != edge.1).collect();
        edges.sort_unstable_by(|a, b| b.cmp(a));
        let mut needs = raw;
        let mut owners: FxHashMap<Need, Code> = FxHashMap::default();
        for &need in needs.values().flatten() {
            owners.entry(need).or_insert_with(|| owner_of(self, need));
        }
        for &class in &classes {
            owners.entry(Need::Class(class)).or_insert_with(|| owner_of(self, Need::Class(class)));
        }
        for (&node, needed) in needs.iter_mut() {
            if let Node::Code(code) = node {
                needed.retain(|need| owners[need] != code);
            }
        }
        loop {
            let mut has_grown = false;
            for &(from, to) in &edges {
                let Some(passed_on) = needs.get(&to).filter(|needed| !needed.is_empty()) else { continue };
                let passed_on: Vec<Need> = match (from, to) {
                    (Node::Class(class), _) => passed_on.iter().copied().filter(|&need| need != Need::Class(class)).collect(),
                    (_, Node::Code(code)) if member_of.contains_key(&code) => vec![Need::Class(member_of[&code])],
                    _ => passed_on.iter().copied().collect(),
                };
                for need in passed_on {
                    let is_at_hand = matches!(from, Node::Code(code) if owners[&need] == code);
                    if !is_at_hand && needs.entry(from).or_default().insert(need) {
                        has_grown = true;
                    }
                }
            }
            if !has_grown {
                break;
            }
        }

        // The lists.
        let as_captures = |needed: &FxHashSet<Need>| -> Vec<Capture> {
            let mut captures: Vec<Capture> = (needed.iter())
                .filter_map(|&need| match need {
                    Need::Variable(sym) => Some(Capture::Variable(sym)),
                    Need::Environment(activation, _) => Some(Capture::Environment(activation)),
                    Need::Closure(_) => None,
                    Need::This(receiver) => Some(Capture::This(receiver)),
                    Need::Arguments(func) => Some(Capture::Arguments(func)),
                    Need::NewTarget(func) => Some(Capture::NewTarget(func)),
                    Need::HomeObject(func) => Some(Capture::HomeObject(func)),
                    // What is kept with a class that is evaluated once is static.
                    Need::Class(class) => classes.contains(&class).then_some(Capture::Environment(Activation::Class(class))),
                })
                .collect();
            captures.sort_unstable();
            captures.dedup();
            captures
        };
        for (&node, needed) in &needs {
            if let Node::Code(Code::Function(func)) = node
                && !needed.is_empty()
            {
                found.capturing.insert(func);
            }
        }
        let mut lists: Vec<(Node, Vec<Capture>)> = needs.iter().map(|(&node, needed)| (node, as_captures(needed))).filter(|list| !list.1.is_empty()).collect();
        lists.sort_unstable_by_key(|list| list.0);
        for (node, captures) in lists {
            match node {
                Node::Class(class) => {
                    found.imports.insert(class, captures);
                }
                Node::Code(Code::Module) => {}
                Node::Code(code) => {
                    let captures = member_of.get(&code).map_or(captures, |&class| vec![Capture::Environment(Activation::Class(class))]);
                    match code {
                        Code::Constructor(class) => {
                            found.capturing_constructors.insert(class);
                            if let Some(func) = self.constructor_of_class(file, class) {
                                found.of_functions.insert(func, captures);
                            }
                        }
                        Code::Function(func) => {
                            found.of_functions.insert(func, captures);
                        }
                        Code::Module => {}
                    }
                }
            }
        }
        let mut expressions: Vec<FnId> = found.of_functions.keys().copied().collect();
        expressions.sort_unstable();
        for func in expressions {
            if let FnOwner::Expr(e) = bound.fns[func.idx()].owner
                && let [Capture::Environment(activation @ Activation::Call(outermost))] = found.of_functions[&func][..]
                && bound.fns[outermost.idx()].enclosing.is_none()
                && bound.fns[func.idx()].enclosing != outermost
                && !self.hir(file)[func].flags.contains(Flags::GENERATOR)
                && self.use_of_value(file, e) & argument_use::OBSERVED == 0
            {
                let kept = found.expressions_kept.entry(activation).or_default();
                found.kept_expressions.insert(func, (activation, (found.environments[&activation].len() + kept.len()) as u32));
                kept.push(func);
            }
        }
        found
    }

    // ───────────────────────────── explanations ─────────────────────────────
}

fn is_loop(kind: &StmtKind) -> bool {
    matches!(kind, StmtKind::For { .. } | StmtKind::ForIn { .. } | StmtKind::ForOf { .. } | StmtKind::While { .. } | StmtKind::DoWhile { .. })
}

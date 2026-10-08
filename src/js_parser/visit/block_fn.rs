#![warn(unused_must_use)]
//! Plain `function` declarations of a block or of a switch case clause.
//!
//! A block has one binding per function name, and the last declaration of the name is its
//! value. In sloppy code each declaration statement also assigns that binding to the `var` of
//! the enclosing function when control reaches it (ECMA-262 Annex B.3.3). esbuild, where this
//! lowering comes from, assigns once at the head of the statement list instead.

use crate::p::P;
use crate::parser::{Ref, RelocateVarsMode};
use bun_alloc::ArenaVec as BumpVec;
use bun_ast as js_ast;
use bun_ast::s::Kind as LocalKind;
use bun_ast::symbol::Kind as SymbolKind;
use bun_ast::{B, E, G, LocRef, S, Stmt, StmtData, StmtNodeList, StoreRef, StrictModeKind};
use bun_collections::VecExt;

/// How the output spells the functions of one name.
#[derive(Clone, Copy)]
enum Spelling {
    /// `let f2 = function() {}` at the head of the list, and `var f = f2` where each
    /// statement stood. A renamer gives the binding of the block its own name.
    TwoNames { var: Ref },
    /// `let f = function() {}` at the head of the list: the binding without the `var`.
    Let,
    /// The statements stay, and the engine does what the mode of the text asks for.
    /// Strict code rejects two declarations of one name, so `all: false` keeps one.
    Declarations { all: bool },
}

struct FnName {
    ref_: Ref,
    /// The last declaration of the name.
    last: Stmt,
    last_fn: StoreRef<S::Function>,
    /// The case clause of `last`.
    last_list: u32,
    count: u32,
    /// How many statements of `last_list` have their output.
    seen: u32,
    spelling: Spelling,
}

/// A function statement of a sloppy block that stays a declaration although `last` declares
/// its name again.
pub(crate) struct SloppyRedeclaration {
    site: StoreRef<S::Function>,
    last: StoreRef<S::Function>,
    scope: StoreRef<js_ast::Scope>,
    /// `site` is the first statement of the name in the statement list of `last`.
    is_first_of_last_list: bool,
}

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool, const SEMA: bool>
    P<'a, TYPESCRIPT, SCAN_ONLY, SEMA>
{
    fn plain_function(&self, stmt: &Stmt) -> Option<(StoreRef<S::Function>, LocRef)> {
        let StmtData::SFunction(func) = stmt.data else {
            return None;
        };
        let name = func.func.name?;
        (self.symbols[name.ref_.inner_index() as usize].kind == SymbolKind::HoistedFunction)
            .then_some((func, name))
    }

    fn note_function(
        names: &mut BumpVec<'a, FnName>,
        stmt: Stmt,
        func: StoreRef<S::Function>,
        ref_: Ref,
        list: u32,
    ) {
        if let Some(name) = names.iter_mut().find(|name| name.ref_ == ref_) {
            name.last = stmt;
            name.last_fn = func;
            name.last_list = list;
            name.count += 1;
        } else {
            names.push(FnName {
                ref_,
                last: stmt,
                last_fn: func,
                last_list: list,
                count: 1,
                seen: 0,
                spelling: Spelling::Let,
            });
        }
    }

    fn block_fn_spelling(&mut self, name: &FnName, is_case_clause: bool) -> Spelling {
        let scope = self.current_scope();
        let (has_direct_eval, strict_mode) = (scope.contains_direct_eval, scope.strict_mode);
        let var = self
            .hoisted_ref_for_sloppy_mode_block_fn
            .get(&name.ref_)
            .copied();
        if has_direct_eval {
            // Direct eval reads both names, so neither can be renamed. They are one again.
            if let Some(var) = var {
                self.symbols[var.inner_index() as usize].link.set(name.ref_);
            }
        } else if let Some(var) = var {
            return Spelling::TwoNames { var };
        } else if !is_case_clause || self.case_clause_fn_stays_let(strict_mode) {
            return Spelling::Let;
        }
        Spelling::Declarations {
            all: name.count == 1
                || (strict_mode == StrictModeKind::SloppyMode && !self.options.bundle),
        }
    }

    /// A `let` in one case clause is in its TDZ from the other clauses, so a function of a
    /// case clause stays a declaration. Without a renamer it keeps its name, and sloppy text
    /// makes that name a `var` of the enclosing function too. The `let` stays where that
    /// `var` would be wrong.
    fn case_clause_fn_stays_let(&self, strict_mode: StrictModeKind) -> bool {
        if self.will_use_renamer() {
            return false;
        }
        // Only the CommonJS wrapper prints a "use strict" directive, and only the one of the
        // file. Strict code that loses its directive runs as sloppy text, unless it is a module.
        let wrapper_prints_directive = self.options.features.commonjs_at_runtime
            && !self.options.features.remove_cjs_module_wrapper
            && self.module_scope().strict_mode == StrictModeKind::ExplicitStrictMode;
        let loses_directive = strict_mode == StrictModeKind::ExplicitStrictMode
            && !self.has_es_module_syntax
            && !wrapper_prints_directive;
        // The REPL wraps each input in a function, which would own the `var`.
        loses_directive
            || (self.options.repl_mode && self.fn_or_arrow_data_visit.is_outside_fn_or_arrow)
    }

    /// `var f = f2`: what a declaration statement does to the `var` of its function.
    fn annex_b_store(&mut self, var: Ref, name: LocRef) -> Option<Stmt> {
        self.record_usage(name.ref_);
        let value = self.new_expr(
            E::Identifier {
                ref_: name.ref_,
                ..Default::default()
            },
            name.loc,
        );
        let decls = [G::Decl {
            binding: self.b(B::Identifier { r#ref: var }, name.loc),
            value: Some(value),
        }];
        let relocated = self.maybe_relocate_vars_to_top_level(&decls, RelocateVarsMode::Normal);
        if relocated.ok {
            return relocated.stmt;
        }
        Some(self.s(
            S::Local {
                kind: LocalKind::KVar,
                decls: G::DeclList::from_slice(&decls),
                ..Default::default()
            },
            name.loc,
        ))
    }

    /// `f = function() {}` for a `let`, from the last declaration of the name. Its statement
    /// has no function afterwards and must leave every list.
    fn block_fn_binding(&mut self, name: &FnName) -> G::Decl {
        let mut last = name.last_fn;
        let mut func = core::mem::take(&mut last.func);
        let name_loc = func.name.take().map_or(name.last.loc, |name| name.loc);
        G::Decl {
            binding: self.b(B::Identifier { r#ref: name.ref_ }, name_loc),
            value: Some(self.new_expr(E::Function { func }, name.last.loc)),
        }
    }

    fn block_fn_let(&mut self, decls: BumpVec<'a, G::Decl>) -> Option<Stmt> {
        let loc = decls.first()?.value?.loc;
        Some(self.s(
            S::Local {
                kind: LocalKind::KLet,
                decls: G::DeclList::from_bump_vec(decls),
                ..Default::default()
            },
            loc,
        ))
    }

    /// The output of one statement of a name that is spelled as declarations.
    fn kept_declaration(
        &mut self,
        name: &mut FnName,
        stmt: Stmt,
        func: StoreRef<S::Function>,
        list: u32,
        all: bool,
    ) -> Option<Stmt> {
        let in_last_list = list == name.last_list;
        let is_first_of_last_list = in_last_list && name.seen == 0;
        name.seen += u32::from(in_last_list);
        if all {
            if func != name.last_fn {
                let scope = self.current_scope_ref();
                self.sloppy_block_fn_redeclarations
                    .push(SloppyRedeclaration {
                        site: func,
                        last: name.last_fn,
                        scope,
                        is_first_of_last_list,
                    });
            }
            return Some(stmt);
        }
        // The declaration that stays is the value of the binding. It takes the place of the
        // first statement of its list, so sloppy text assigns the `var` no later than the
        // source does.
        is_first_of_last_list.then_some(name.last)
    }

    /// `before` has the visited function statements of the list and what `s_function` put
    /// after them. `visited` has each of those statements again, where it stood.
    #[inline(never)]
    pub(crate) fn lower_block_level_functions(
        &mut self,
        before: &mut BumpVec<'a, Stmt>,
        visited: &mut BumpVec<'a, Stmt>,
    ) {
        let mut names = BumpVec::<FnName>::new_in(self.arena);
        for stmt in before.iter() {
            if let Some((func, name)) = self.plain_function(stmt) {
                Self::note_function(&mut names, *stmt, func, name.ref_, 0);
            }
        }
        if names.is_empty() {
            return;
        }
        for i in 0..names.len() {
            names[i].spelling = self.block_fn_spelling(&names[i], false);
        }

        let mut end = 0;
        for i in 0..visited.len() {
            let stmt = visited[i];
            let output = match self.plain_function(&stmt) {
                None => Some(stmt),
                Some((func, name)) => match names.iter_mut().find(|n| n.ref_ == name.ref_) {
                    None => Some(stmt),
                    Some(entry) => match entry.spelling {
                        Spelling::TwoNames { var } => self.annex_b_store(var, name),
                        Spelling::Let => None,
                        Spelling::Declarations { all } => {
                            self.kept_declaration(entry, stmt, func, 0, all)
                        }
                    },
                },
            };
            if let Some(output) = output {
                visited[end] = output;
                end += 1;
            }
        }
        visited.truncate(end);

        before.retain(|stmt| !matches!(stmt.data, StmtData::SFunction(_)));
        let mut decls = BumpVec::<G::Decl>::new_in(self.arena);
        for name in names.iter() {
            if !matches!(name.spelling, Spelling::Declarations { .. }) {
                decls.push(self.block_fn_binding(name));
            }
        }
        if let Some(stmt) = self.block_fn_let(decls) {
            before.insert(0, stmt);
        }
    }

    /// A case clause is one slice of the block of its `switch`, and a direct eval in a later
    /// clause decides the spelling of an earlier one. So `s_switch` calls this once every
    /// clause is visited.
    #[cold]
    #[inline(never)]
    pub(crate) fn lower_case_clause_functions(&mut self, cases: &mut [js_ast::Case]) {
        let mut names = BumpVec::<FnName>::new_in(self.arena);
        for (clause, case) in cases.iter().enumerate() {
            for stmt in case.body.slice() {
                if let Some((func, name)) = self.plain_function(stmt) {
                    Self::note_function(&mut names, *stmt, func, name.ref_, clause as u32);
                }
            }
        }
        for i in 0..names.len() {
            names[i].spelling = self.block_fn_spelling(&names[i], true);
            // Sloppy output makes the printed name of a declaration a `var` of the function
            // too, so the renamer has to pick a name that is free there.
            if self.will_use_renamer() && !matches!(names[i].spelling, Spelling::Let) {
                self.declare_temp_var(names[i].ref_);
            }
        }

        for (clause, case) in cases.iter_mut().enumerate() {
            let clause = clause as u32;
            let body: &'a [Stmt] = case.body.slice();
            if !body.iter().any(|stmt| self.plain_function(stmt).is_some()) {
                continue;
            }
            let mut out = BumpVec::<Stmt>::with_capacity_in(body.len() + names.len(), self.arena);
            for stmt in body {
                let Some((func, name)) = self.plain_function(stmt) else {
                    out.push(*stmt);
                    continue;
                };
                let Some(entry) = names.iter_mut().find(|n| n.ref_ == name.ref_) else {
                    out.push(*stmt);
                    continue;
                };
                match entry.spelling {
                    Spelling::TwoNames { var } => {
                        if func == entry.last_fn {
                            out.push(*stmt);
                        }
                        out.extend(self.annex_b_store(var, name));
                    }
                    Spelling::Let => {}
                    Spelling::Declarations { all } => {
                        out.extend(self.kept_declaration(entry, *stmt, func, clause, all));
                    }
                }
            }
            let mut decls = BumpVec::<G::Decl>::new_in(self.arena);
            for name in names.iter() {
                if matches!(name.spelling, Spelling::Let) && name.last_list == clause {
                    decls.push(self.block_fn_binding(name));
                }
            }
            if let Some(stmt) = self.block_fn_let(decls) {
                out.insert(0, stmt);
            }
            case.body = StmtNodeList::from_bump(out);
        }
    }

    /// Whether the binding of `name` in the current scope has the function of this statement
    /// as its value. A block can declare the name again.
    #[inline(never)]
    pub(crate) fn block_binding_holds_function(&self, name: &[u8], func: &S::Function) -> bool {
        let scope = self.current_scope();
        if scope.kind_stops_hoisting() {
            return true;
        }
        let Some(loc) = func.func.name.map(|name| name.loc) else {
            return true;
        };
        scope
            .get_member_with_hash(name, js_ast::Scope::get_member_hash(name))
            .is_none_or(|member| member.loc == loc)
    }

    /// Strict code rejects two declarations of one name in a block. So text that does not run
    /// as sloppy CommonJS keeps one per name, as `kept_declaration` places it, and every other
    /// one becomes an empty function with a name of its own.
    #[cold]
    #[inline(never)]
    pub(crate) fn rename_sloppy_block_fn_redeclarations(&mut self) {
        let redeclarations = core::mem::replace(
            &mut self.sloppy_block_fn_redeclarations,
            BumpVec::new_in(self.arena),
        );
        for mut redeclaration in redeclarations {
            let mut unused = redeclaration.site;
            if redeclaration.is_first_of_last_list {
                core::mem::swap(&mut redeclaration.site.func, &mut redeclaration.last.func);
                unused = redeclaration.last;
            }
            let ref_ = self.generate_temp_ref_with_scope(None, redeclaration.scope);
            unused.func = G::Fn {
                name: unused.func.name.map(|name| LocRef {
                    loc: name.loc,
                    ref_,
                }),
                open_parens_loc: unused.func.open_parens_loc,
                body: G::FnBody {
                    loc: unused.func.body.loc,
                    stmts: StmtNodeList::EMPTY,
                },
                ..Default::default()
            };
        }
    }
}

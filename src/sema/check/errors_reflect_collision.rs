//! A name that gets in the way of what `super` in a static initializer is emitted as: 2818.
//!
//! Before ES2022, `super.x` in the initializer of a static property or in a static block is emitted as a call of `Reflect.get`, so
//! nothing it can see may be called `Reflect`. Follows `checkSuperExpression`, as far as it sets
//! `NodeCheckFlagsContainsSuperPropertyInStaticInitializer`, `recordPotentialCollisionWithReflectInGeneratedCode`,
//! `needCollisionCheckForIdentifier`, `checkReflectCollision` and whatever calls `checkCollisionsForDeclarationName`, of TypeScript
//! 7.0.2's checker.go.

use super::errors::Diagnostic;
use super::*;
use crate::bind::{ClassOwner, FnOwner, MemberOwner, Parent, PatParent};
use crate::resolve::ScriptTarget;

/// `IsBlockScope`
#[derive(Copy, Clone, PartialEq, Eq)]
enum BlockScope {
    File,
    Module(ModuleId),
    /// A function, a method, an accessor, a constructor or a static block.
    Fn(FnId),
    /// The declaration of a property of a class.
    Property(MemberId),
    /// A block that is not the body of a function, a `for` statement, or what is between the braces of a `switch`.
    Stmt(StmtId),
    /// The `catch` clause of a `try` statement.
    Catch(StmtId),
}

impl Checker<'_> {
    pub(super) fn check_reflect_collisions(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let files = self.files();
        let (hir, bound, options) = (self.hir(file), self.bound(file), &files.options);
        // `languageVersion <= ES2021`: no target is a later one. `errorSkippedOnNoEmit`. All of a declaration file is ambient.
        if options.target == ScriptTarget::None
            || options.target > ScriptTarget::ES2021
            || options.no_emit_said
            || hir.kind == FileKind::Declaration
        {
            return;
        }
        let Some(reflect) = files.atoms.lookup(b"Reflect") else {
            return;
        };
        let marked = self.rc_block_scopes_with_super_in_static_initializer(file);
        if marked.is_empty() {
            return;
        }
        // `GetEnclosingBlockScopeContainer` of what is directly in `at`, or of the statement `at` if it is no block scope, has the flag.
        let is_marked = |c: &Self, at: Parent| {
            c.rc_block_scopes_around(file, at)
                .first()
                .is_some_and(|scope| marked.contains(scope))
        };
        let is_ambient = |flags: Flags| flags.contains(Flags::AMBIENT);
        // `GetErrorRangeForNode` of each declaration that collides.
        let mut collisions: Vec<(u32, u32)> = Vec::new();
        for (i, stmt) in hir.stmts.iter().enumerate() {
            let (s, around) = (StmtId(i as u32), bound.stmt_parent[i]);
            match stmt.kind {
                StmtKind::Fn(f) if hir[f].name == reflect && !is_ambient(hir[f].flags) => {}
                StmtKind::Class(c) if hir[c].name == reflect && !is_ambient(hir[c].flags) => {}
                StmtKind::Enum(e) if hir[e].name == reflect && !is_ambient(hir[e].flags) => {}
                // `checkGrammarModuleElementContext`
                StmtKind::Module(m)
                    if hir[m].name == ModuleName::Ident(reflect)
                        && !is_ambient(hir[m].flags)
                        && matches!(around, Parent::File | Parent::Module(_)) => {}
                // `checkImportDeclaration`, `checkImportBinding`. Elsewhere a module can only be named in what is ambient.
                StmtKind::Import(x) if around == Parent::File && hir[x].spec.is_some() => {
                    let import = hir[x];
                    if !marked.contains(&BlockScope::File) {
                        continue;
                    }
                    if import.default == reflect && !import.type_only {
                        let end = self.rc_end_of_import_clause(file, &import);
                        collisions.push((import.default_pos, end));
                    }
                    if import.namespace == reflect {
                        let end = self.end_of_name_at(file, import.namespace_pos);
                        collisions.push((import.namespace_pos, end));
                    }
                    let mode = files.mode_of_import(file, import.mode);
                    if import.type_only
                        || files
                            .module_of_specifier_as(file, import.spec, mode)
                            .is_none()
                    {
                        continue;
                    }
                    for spec in import.named.iter() {
                        let named = hir[spec];
                        if named.local == reflect && !named.type_only {
                            collisions.push((
                                named.pos.min(named.imported_pos),
                                self.end_of_import_spec(file, spec),
                            ));
                        }
                    }
                    continue;
                }
                // `checkImportEqualsDeclaration`
                StmtKind::ImportEquals(x) if hir[x].name == reflect => {
                    let import = hir[x];
                    let is_in_place = match import.target {
                        ImportEqualsTarget::Entity(_) => {
                            matches!(around, Parent::File | Parent::Module(_))
                        }
                        ImportEqualsTarget::Require(spec) => {
                            spec.is_some() && around == Parent::File
                        }
                    };
                    if is_in_place
                        && !import.flags.intersects(Flags::AMBIENT | Flags::TYPE_ONLY)
                        && is_marked(&*self, Parent::Stmt(s))
                    {
                        collisions.push((stmt.pos, self.end_of_stmt(file, s)));
                    }
                    continue;
                }
                _ => continue,
            }
            if is_marked(&*self, Parent::Stmt(s)) {
                collisions.push(self.error_range_of_stmt(file, s));
            }
        }
        // The name of a function expression is in nobody's way but that of what is in the function.
        for (i, func) in hir.fns.iter().enumerate() {
            if func.kind == FnKind::Expr
                && func.name == reflect
                && marked.contains(&BlockScope::Fn(FnId(i as u32)))
            {
                let end = self.end_of_name_at(file, func.name_pos);
                collisions.push((func.name_pos, end));
            }
        }
        // The same goes for a class expression and its members.
        for (i, class) in hir.classes.iter().enumerate() {
            if class.name == reflect
                && matches!(bound.class_owner[i], ClassOwner::Expr(_))
                && class.members.iter().any(|m| {
                    marked.contains(&if hir[m].func.is_some() {
                        BlockScope::Fn(hir[m].func)
                    } else {
                        BlockScope::Property(m)
                    })
                })
            {
                let end = self.end_of_name_at(file, class.name_pos);
                collisions.push((class.name_pos, end));
            }
        }
        // `checkVariableLikeDeclaration`
        for (i, pat) in hir.pats.iter().enumerate() {
            if !matches!(pat.kind, PatKind::Ident(name) if name == reflect) {
                continue;
            }
            // `GetRootDeclaration`
            let mut root = bound.pat_parent[i];
            while let PatParent::Prop(outer, _) | PatParent::Elem(outer, _) = root {
                root = bound.pat_parent[outer.idx()];
            }
            let name = (pat.pos, self.end_of_name_at(file, pat.pos));
            let (at, range) = match root {
                // `const Reflect = require("m")` in JavaScript is an alias, and looked at no further.
                PatParent::Var(d)
                    if !is_ambient(hir[d].flags)
                        && !matches!(bound.required_by(hir, PatId(i as u32)), Some((_, None))) =>
                {
                    (Parent::VarInit(d), name)
                }
                // One of a function without a body is not emitted.
                PatParent::Param(p) => {
                    let f = bound.param_fn[p.idx()];
                    if f.is_none()
                        || is_ambient(hir[f].flags)
                        || matches!(hir[f].body, FnBody::None)
                    {
                        continue;
                    }
                    let is_parameter = bound.pat_parent[i] == root;
                    (
                        Parent::ParamDefault(p),
                        if is_parameter {
                            (hir[p].pos, self.end_of_param(file, p))
                        } else {
                            name
                        },
                    )
                }
                _ => continue,
            };
            if is_marked(&*self, at) {
                collisions.push(range);
            }
        }
        for (start, end) in collisions {
            out.push(Diagnostic { start, code: 2818 });
            self.note(
                start,
                end,
                2818,
                vec!["Reflect".to_owned(), "Reflect".to_owned()],
            );
        }
    }

    /// `checkSuperExpression`: the block scopes that get `NodeCheckFlagsContainsSuperPropertyInStaticInitializer`.
    fn rc_block_scopes_with_super_in_static_initializer(
        &mut self,
        file: FileId,
    ) -> Vec<BlockScope> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let is_module = self.files().module(file).is_module();
        let index = self.exprs_by_kind(file);
        let mut marked: Vec<BlockScope> = Vec::new();
        for &e in index.of(ExprTag::Super) {
            let around = bound.expr_parent[e.idx()];
            let is_call = matches!(around, Parent::Expr(p) if p.is_some()
                && matches!(hir[p].kind, ExprKind::Call(c) if hir[c].callee == e));
            if is_call {
                continue;
            }
            let Some(member) = self.rc_static_initializer_around(file, around) else {
                continue;
            };
            let MemberOwner::Class(class) = bound.member_owner[member.idx()] else {
                continue;
            };
            let extends = hir[class].extends;
            if extends.is_none() {
                continue;
            }
            // `checkSuperExpression` returns before it marks anything: `classDeclarationExtendsNull`, `baseClassType == nil`.
            let sym = self.class_sym(file, class);
            if self.class_declaration_extends_null(sym) || self.base_types(sym).is_empty() {
                continue;
            }
            for scope in self.rc_block_scopes_around(file, around) {
                // `IsExternalOrCommonJSModule`
                if (scope != BlockScope::File || is_module) && !marked.contains(&scope) {
                    marked.push(scope);
                }
            }
        }
        marked
    }

    /// `getSuperContainer`, past the arrow functions: the static property or the static block whose initializer or body what is directly
    /// in `at` is part of.
    fn rc_static_initializer_around(&self, file: FileId, mut at: Parent) -> Option<MemberId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        loop {
            at = match at {
                Parent::MemberInit(m) => return hir[m].flags.contains(Flags::STATIC).then_some(m),
                Parent::FnBody(_) | Parent::ParamDefault(_) => {
                    let f = match at {
                        Parent::ParamDefault(p) => bound.param_fn[p.idx()],
                        Parent::FnBody(f) => f,
                        _ => FnId::NONE,
                    };
                    if f.is_none() {
                        return None;
                    }
                    match (hir[f].kind, bound.fns[f.idx()].owner) {
                        (FnKind::Arrow, _) => self.outward(file, Parent::FnBody(f)),
                        (FnKind::StaticBlock, FnOwner::Member(m)) => return Some(m),
                        _ => return None,
                    }
                }
                Parent::Key(owner) if owner.is_some() => Parent::Expr(owner),
                Parent::None
                | Parent::File
                | Parent::Module(_)
                | Parent::Key(_)
                | Parent::MemberKey
                | Parent::EnumInit(_)
                | Parent::Decorator(..) => return None,
                Parent::Expr(e) if e.is_none() => return None,
                Parent::Stmt(s) if s.is_none() => return None,
                other => self.outward(file, other),
            };
        }
    }

    /// `GetEnclosingBlockScopeContainer`, over and over: the block scopes around what is directly in `at`, innermost first. It ends
    /// where it is not kept track of what is around.
    fn rc_block_scopes_around(&self, file: FileId, mut at: Parent) -> Vec<BlockScope> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut scopes = Vec::new();
        loop {
            at = match at {
                Parent::File => {
                    scopes.push(BlockScope::File);
                    return scopes;
                }
                Parent::Module(m) => {
                    scopes.push(BlockScope::Module(m));
                    let declaration = hir
                        .stmts
                        .iter()
                        .position(|s| matches!(s.kind, StmtKind::Module(x) if x == m));
                    match declaration {
                        Some(s) => bound.stmt_parent[s],
                        None => return scopes,
                    }
                }
                Parent::FnBody(f) => {
                    scopes.push(BlockScope::Fn(f));
                    self.outward(file, at)
                }
                Parent::ParamDefault(p) if bound.param_fn[p.idx()].is_some() => {
                    scopes.push(BlockScope::Fn(bound.param_fn[p.idx()]));
                    self.outward(file, at)
                }
                Parent::MemberInit(m) => {
                    scopes.push(BlockScope::Property(m));
                    self.outward(file, at)
                }
                // What a `case` is tested against is between the braces, what is switched on is not.
                Parent::Case(c) => {
                    let s = bound.case_stmt[c.idx()];
                    scopes.push(BlockScope::Stmt(s));
                    Parent::Stmt(s)
                }
                Parent::VarInit(d) => {
                    let s = bound.var_stmt[d.idx()];
                    if s.is_some()
                        && matches!(hir[s].kind, StmtKind::Try { param, .. } if param == d)
                    {
                        scopes.push(BlockScope::Catch(s));
                    }
                    Parent::Stmt(s)
                }
                Parent::Stmt(s) if s.is_some() => {
                    if matches!(
                        hir[s].kind,
                        StmtKind::Block(_)
                            | StmtKind::For { .. }
                            | StmtKind::ForIn { .. }
                            | StmtKind::ForOf { .. }
                    ) {
                        scopes.push(BlockScope::Stmt(s));
                    }
                    let up = bound.stmt_parent[s.idx()];
                    if let Parent::Stmt(outer) = up
                        && outer.is_some()
                    {
                        match hir[outer].kind {
                            StmtKind::Switch { .. } => scopes.push(BlockScope::Stmt(outer)),
                            StmtKind::Try { handler, .. } if handler == s => {
                                scopes.push(BlockScope::Catch(outer));
                            }
                            _ => {}
                        }
                    }
                    up
                }
                Parent::Key(owner) if owner.is_some() => Parent::Expr(owner),
                Parent::None
                | Parent::Stmt(_)
                | Parent::ParamDefault(_)
                | Parent::Key(_)
                | Parent::MemberKey
                | Parent::EnumInit(_) => return scopes,
                Parent::Expr(e) if e.is_none() => return scopes,
                other => self.outward(file, other),
            };
        }
    }

    /// `node.End()` of the import clause of `import`, which has a default import: that, and the `{ .. }` or `* as ns` after it.
    fn rc_end_of_import_clause(&self, file: FileId, import: &Import) -> u32 {
        if import.namespace.is_some() {
            return self.end_of_name_at(file, import.namespace_pos);
        }
        let text = &self.hir(file).text;
        let name_end = self.end_of_name_at(file, import.default_pos);
        let comma = self.skip_trivia_from(file, name_end);
        if text.get(comma as usize) != Some(&b',') {
            return name_end;
        }
        let brace = self.skip_trivia_from(file, comma + 1);
        if text.get(brace as usize) == Some(&b'{') {
            self.end_of_bracket_at(file, brace)
        } else {
            name_end
        }
    }
}

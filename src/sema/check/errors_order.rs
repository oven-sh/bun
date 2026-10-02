//! What is used before it is there: 2448 2449 2450 2729.
//!
//! Follows `checkResolvedBlockScopedVariable`, `isBlockScopedNameDeclaredBeforeUse`, `isUsedInFunctionOrInstanceProperty`,
//! `isPropertyImmediatelyReferencedWithinDeclaration` and `checkPropertyNotUsedBeforeDeclaration` of TypeScript 7.0.2's checker.go.

use super::errors::Diagnostic;
use super::*;
use crate::bind::{ClassOwner, Decl, FnOwner, MemberOwner, Parent, PatParent, ScopeId, ScopeKind};

/// What a computed name is the name of.
pub(super) enum Named {
    /// A property of the object literal given.
    Property(ExprId),
    /// A method or an accessor of the object literal given.
    Function(ExprId),
    /// An element of a pattern.
    Element(PatPropId),
    /// A member of a class, an interface or a type literal.
    Member(MemberId),
    Unknown,
}

/// `GetEnclosingBlockScopeContainer`
#[derive(Copy, Clone, PartialEq, Eq)]
enum Container {
    /// A function or a static block.
    Fn(FnId),
    /// A block, a `for`, a `switch`, or the `catch` of the `try` given.
    Stmt(StmtId),
    /// A property of a class, with its name, its decorators and its initializer.
    Property(MemberId),
    /// A namespace or the file: nothing around those runs later.
    Top,
}

/// What `isUsedInFunctionOrInstanceProperty` asks about a declaration.
#[derive(Copy, Clone)]
struct Declaration {
    container: Container,
    /// It starts before the use.
    is_before: bool,
    /// A method, of a class or of an object literal.
    is_method: bool,
    /// An instance property of the class the use is in.
    is_own_instance_property: bool,
    /// `isPropertyInitializedInStaticBlocks`, by the time the static property the use is in is initialized.
    is_set_in_static_blocks: bool,
}

impl Declaration {
    /// Something that is no member of a class and comes after the use.
    fn further_down(container: Container) -> Declaration {
        Declaration {
            container,
            is_before: false,
            is_method: false,
            is_own_instance_property: false,
            is_set_in_static_blocks: false,
        }
    }
}

impl Checker<'_> {
    pub(super) fn check_use_before_declaration(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if hir.kind == FileKind::Declaration {
            return;
        }
        let index = self.exprs_by_kind(file);
        let runs_in_place = self.has_function_run_in_place(file);
        for &e in index.of(ExprTag::Ident) {
            if !bound.is_unchecked(e.idx()) {
                self.check_name_declared_before_use(file, e, runs_in_place, out);
            }
        }
        // Without a class only what is in the initializer of a member or in a static block is looked at.
        let has_static_block = hir.fns.iter().any(|f| f.kind == FnKind::StaticBlock);
        if hir.classes.is_empty()
            && !has_static_block
            && !hir.members.iter().any(|m| m.init.is_some())
        {
            return;
        }
        for &e in index.of(ExprTag::Dot) {
            if let ExprKind::Dot {
                obj,
                name,
                name_pos,
                ..
            } = hir[e].kind
                && !bound.is_unchecked(e.idx())
            {
                self.check_property_not_used_before_declaration(
                    file,
                    e,
                    obj,
                    name,
                    name_pos,
                    has_static_block,
                    out,
                );
            }
        }
    }

    /// Whether some function of `file` may run where it is written: a static block, or a function expression that is called there.
    /// If none does, the way out of a statement leads to nothing that is worked out together with it.
    pub(super) fn has_function_run_in_place(&self, file: FileId) -> bool {
        let hir = self.hir(file);
        (0..hir.fns.len()).any(|f| {
            hir.fns[f].kind == FnKind::StaticBlock
                || self.is_immediately_invoked(file, FnId(f as u32))
        })
    }

    /// `checkResolvedBlockScopedVariable`. `runs_in_place`: `has_function_run_in_place`.
    fn check_name_declared_before_use(
        &mut self,
        file: FileId,
        e: ExprId,
        runs_in_place: bool,
        out: &mut Vec<Diagnostic>,
    ) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let local = bound.expr_symbol[e.idx()];
        if local.is_none() {
            return;
        }
        let symbol = &bound.symbols[local.idx()];
        let flags = symbol.flags;
        if !flags.intersects(SymFlags::BLOCK_SCOPED_VARIABLE | SymFlags::CLASS | SymFlags::ENUM)
            || flags.contains(SymFlags::CLASS)
                && flags.intersects(SymFlags::FUNCTION | SymFlags::FUNCTION_SCOPED_VARIABLE)
            || bound.is_in_type_query(e)
            || self.is_export_assigned(file, e)
        {
            return;
        }
        // `mergeSymbol`: what does not go with what an earlier file declared is left out, and the name goes on meaning that. And
        // what another file declares counts as declared.
        if flags.contains(SymFlags::MERGED) {
            let sym = self.files().sym(file, local);
            let first = self
                .files()
                .decls(sym)
                .into_iter()
                .find(|&(of, d)| match d {
                    Decl::Var(_) | Decl::Fn(_) | Decl::Class(_) | Decl::Enum(_) => true,
                    // A namespace with something in it goes with a class or an enum, not with a variable.
                    Decl::Module(m) => {
                        flags.contains(SymFlags::BLOCK_SCOPED_VARIABLE)
                            && self.bound(of).module_instantiated[m.idx()]
                    }
                    _ => false,
                });
            if first.is_none_or(|(of, _)| of != file) {
                return;
            }
        }
        let usage = hir[e].pos;
        // The first that is a `let`, a `const`, what `catch` binds, a class or an enum: whether it is there, and what to say if not.
        let found = symbol.decls.iter().find_map(|&d| match d {
            Decl::Var(pat) => {
                let decl = self.variable_declaration_of(file, pat)?;
                if hir[decl].kind == VarKind::Var && bound.var_stmt[decl.idx()].is_some() {
                    return None;
                }
                Some((
                    hir[decl].flags.contains(Flags::AMBIENT)
                        || self.is_variable_declared_before_use(
                            file,
                            e,
                            usage,
                            pat,
                            decl,
                            runs_in_place,
                        ),
                    2448,
                    hir[pat].pos,
                ))
            }
            Decl::Class(c) => Some((
                hir[c].flags.contains(Flags::AMBIENT)
                    || self.is_class_declared_before_use(file, e, c, usage),
                2449,
                hir[c].name_pos,
            )),
            Decl::Enum(en) => {
                if hir[en].flags.contains(Flags::AMBIENT)
                    || hir[en].name_pos <= usage
                    || hir[en].flags.contains(Flags::CONST)
                        && !self.p.files.options.isolated_modules
                {
                    return Some((true, 2450, hir[en].name_pos));
                }
                let s = self.stmt_of_enum(file, en)?;
                Some((
                    self.is_use_deferred_in(file, e, Parent::Stmt(s)),
                    2450,
                    hir[en].name_pos,
                ))
            }
            _ => None,
        });
        if let Some((false, code, declared_at)) = found {
            out.push(Diagnostic { start: usage, code });
            // The name as the declaration writes it.
            self.explain(usage, code, |c| {
                vec![c.declaration_name_at(file, declared_at)]
            });
            self.relate(usage, code, |c| {
                let name = c.declaration_name_at(file, declared_at);
                vec![c.declared_here(c.place_of_token(file, declared_at), name)]
            });
        }
    }

    /// `export = e` only says what is to be had.
    fn is_export_assigned(&self, file: FileId, e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        matches!(bound.expr_parent[e.idx()], Parent::Stmt(s) if s.is_some() && matches!(hir[s].kind, StmtKind::ExportAssign(_)))
            && !is_parenthesized(hir, e)
    }

    /// The declaration whose pattern binds `pat`, if it is a variable.
    fn variable_declaration_of(&self, file: FileId, mut pat: PatId) -> Option<VarDeclId> {
        let bound = self.bound(file);
        loop {
            match bound.pat_parent[pat.idx()] {
                PatParent::Prop(outer, _) | PatParent::Elem(outer, _) => pat = outer,
                PatParent::Var(d) => return Some(d),
                _ => return None,
            }
        }
    }

    /// The statement that declares the enum `en`.
    fn stmt_of_enum(&self, file: FileId, en: EnumId) -> Option<StmtId> {
        let hir = self.hir(file);
        (0..hir.stmts.len() as u32)
            .map(StmtId)
            .find(|&s| matches!(hir[s].kind, StmtKind::Enum(x) if x == en))
    }

    /// `isBlockScopedNameDeclaredBeforeUse` of the variable `pat` of the declaration `decl`, used at `e` (a name, or `a.b.c`) of the
    /// same file, which is not what `export =` gives.
    pub(super) fn is_const_declared_before_use(
        &self,
        file: FileId,
        e: ExprId,
        pat: PatId,
        decl: VarDeclId,
    ) -> bool {
        let hir = self.hir(file);
        if self.bound(file).is_in_type_query(e) {
            return true;
        }
        let first = first_identifier(hir, e);
        self.is_variable_declared_before_use(file, e, hir[first].pos, pat, decl, true)
    }

    /// The same, of a use in `e` that starts at `usage`. `runs_in_place`: `has_function_run_in_place`, or true if that was not asked.
    fn is_variable_declared_before_use(
        &self,
        file: FileId,
        e: ExprId,
        usage: u32,
        pat: PatId,
        decl: VarDeclId,
        runs_in_place: bool,
    ) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // A binding element starts at the name of the property it takes.
        let start = match bound.pat_parent[pat.idx()] {
            PatParent::Prop(_, prop) if !hir[prop].is_rest => hir[prop].pos.min(hir[pat].pos),
            _ => hir[pat].pos,
        };
        if start <= usage {
            self.is_not_used_within_its_declaration(file, e, pat, decl, runs_in_place)
        } else {
            self.is_use_deferred_in(file, e, Parent::Stmt(bound.var_stmt[decl.idx()]))
        }
    }

    /// `isBlockScopedNameDeclaredBeforeUse` of the class `c`, named in `e`, at `usage`. Whether the class is only declared is for
    /// the caller to ask.
    fn is_class_declared_before_use(
        &self,
        file: FileId,
        e: ExprId,
        c: ClassId,
        usage: u32,
    ) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // Its decorators are part of the declaration. The old kind runs once the class is there; the new kind before, so
        // that only a function in one, which runs later, can name the class.
        if let Some(in_function) = self.is_in_decorator_of(file, e, c) {
            return self.p.files.options.experimental_decorators || in_function;
        }
        match bound.class_owner[c.idx()] {
            ClassOwner::Stmt(s) if hir[s].pos > usage => {
                self.is_use_deferred_in(file, e, Parent::Stmt(s))
            }
            // The name of a class expression is only seen from inside: it starts before any use.
            _ => !self.is_in_computed_name_of(file, e, c),
        }
    }

    /// Whether `e` is in a decorator of the class `c`, of a member or of a parameter of it; and if so, whether a function that is
    /// not immediately invoked lies between `e` and the decorator. The class-like case of `isBlockScopedNameDeclaredBeforeUse`.
    fn is_in_decorator_of(&self, file: FileId, e: ExprId, c: ClassId) -> Option<bool> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if hir.decorators.is_empty() {
            return None;
        }
        let mut below = e;
        let mut parent = bound.expr_parent[e.idx()];
        let mut in_function = false;
        loop {
            parent = match parent {
                Parent::Decorator(of, _) if of == c => return Some(in_function),
                Parent::None | Parent::File => return None,
                Parent::Stmt(s) if s.is_none() => return None,
                Parent::Expr(x) if x.is_none() => return None,
                Parent::Expr(x) => {
                    below = x;
                    bound.expr_parent[x.idx()]
                }
                // `IsFunctionLike`: a parameter is a child of its function. A static block is not function-like.
                Parent::FnBody(_) | Parent::ParamDefault(_) => {
                    let f = match parent {
                        Parent::FnBody(f) => f,
                        Parent::ParamDefault(p) => bound.param_fn[p.idx()],
                        _ => unreachable!(),
                    };
                    in_function |=
                        hir[f].kind != FnKind::StaticBlock && !self.is_immediately_invoked(file, f);
                    self.outward(file, parent)
                }
                // A decorator of another class is a child of the declaration it decorates.
                Parent::Decorator(_, owner) => {
                    in_function |= match owner {
                        DecoratorOwner::Class(_) => false,
                        DecoratorOwner::Member(m) => hir[m].kind != MemberKind::Property,
                        DecoratorOwner::Param(_) => true,
                    };
                    self.outward(file, parent)
                }
                // A computed name is a child of the declaration it names.
                Parent::Key(_) | Parent::MemberKey => match self.what_is_named(file, parent, below)
                {
                    Named::Property(literal) => Parent::Expr(literal),
                    Named::Function(literal) => {
                        in_function = true;
                        Parent::Expr(literal)
                    }
                    Named::Element(p) => self.outward(file, Parent::PatPropDefault(p)),
                    Named::Member(m) => {
                        in_function |= hir[m].kind != MemberKind::Property;
                        self.parent_of(file, Parent::MemberInit(m))
                    }
                    Named::Unknown => return None,
                },
                _ => self.outward(file, parent),
            };
        }
    }

    /// `GetImmediatelyInvokedFunctionExpression(f) != nil`
    pub(super) fn is_immediately_invoked(&self, file: FileId, f: FnId) -> bool {
        self.bound(file)
            .get_immediately_invoked_function_expression(self.hir(file), f)
            .is_some()
    }

    /// What is around what `parent` stands for, patterns and `extends` included. `None`: it is not kept track of.
    #[inline]
    pub(super) fn outward(&self, file: FileId, parent: Parent) -> Parent {
        match parent {
            Parent::PatPropDefault(_)
            | Parent::PatElemDefault(_)
            | Parent::ClassExtends(_)
            | Parent::Decorator(..) => self.outward_from_pattern_or_class(file, parent),
            _ => self.parent_of(file, parent),
        }
    }

    fn outward_from_pattern_or_class(&self, file: FileId, parent: Parent) -> Parent {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let of_pattern = |mut pat: PatId| loop {
            match bound.pat_parent[pat.idx()] {
                PatParent::Prop(outer, _) | PatParent::Elem(outer, _) => pat = outer,
                PatParent::Var(d) => return Parent::VarInit(d),
                PatParent::Param(p) => return Parent::ParamDefault(p),
                PatParent::None => return Parent::None,
            }
        };
        match parent {
            Parent::PatPropDefault(p) => of_pattern(hir[p].value),
            Parent::PatElemDefault(p) => of_pattern(hir[p].pat),
            Parent::ClassExtends(c) | Parent::Decorator(c, _) => match bound.class_owner[c.idx()] {
                ClassOwner::Expr(x) => Parent::Expr(x),
                ClassOwner::Stmt(s) => Parent::Stmt(s),
            },
            _ => self.parent_of(file, parent),
        }
    }

    /// What the computed name `key`, whose parent is `parent` (`Key` or `MemberKey`), is the name of.
    pub(super) fn what_is_named(&self, file: FileId, parent: Parent, key: ExprId) -> Named {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let name = PropKey::Computed(key);
        match parent {
            Parent::Key(owner) if owner.is_some() => Named::Property(owner),
            Parent::Key(_) => match hir.pat_props.iter().position(|p| p.key == name) {
                Some(p) => Named::Element(PatPropId(p as u32)),
                None => Named::Unknown,
            },
            _ => {
                if let Some(m) = hir.members.iter().position(|m| m.key == name) {
                    Named::Member(MemberId(m as u32))
                } else if let Some(p) = hir.props.iter().position(|p| p.key == name) {
                    Named::Function(bound.prop_owner[p])
                } else {
                    Named::Unknown
                }
            }
        }
    }

    /// `GetEnclosingBlockScopeContainer`, of what is directly in `parent`. `None`: it is not kept track of.
    fn block_scope_around(&self, file: FileId, mut parent: Parent) -> Option<Container> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        loop {
            parent = match parent {
                Parent::FnBody(f) => return Some(Container::Fn(f)),
                Parent::ParamDefault(p) | Parent::Decorator(_, DecoratorOwner::Param(p)) => {
                    return Some(Container::Fn(bound.param_fn[p.idx()]));
                }
                Parent::MemberInit(m) => return Some(Container::Property(m)),
                Parent::Decorator(_, DecoratorOwner::Member(m)) => {
                    return Some(if hir[m].func.is_some() {
                        Container::Fn(hir[m].func)
                    } else {
                        Container::Property(m)
                    });
                }
                Parent::File | Parent::Module(_) => return Some(Container::Top),
                Parent::Stmt(s) if s.is_none() => return None,
                Parent::Stmt(s)
                    if matches!(
                        hir[s].kind,
                        StmtKind::Block(_)
                            | StmtKind::For { .. }
                            | StmtKind::ForIn { .. }
                            | StmtKind::ForOf { .. }
                            | StmtKind::Switch { .. }
                            | StmtKind::Try { .. }
                    ) =>
                {
                    return Some(Container::Stmt(s));
                }
                Parent::Expr(x) if x.is_none() => return None,
                Parent::None | Parent::Key(_) | Parent::MemberKey | Parent::EnumInit(_) => {
                    return None;
                }
                _ => self.outward(file, parent),
            };
        }
    }

    /// The same, of a type that is written in `scope`.
    fn block_scope_around_type_in(&self, file: FileId, mut scope: ScopeId) -> Option<Container> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        while scope.is_some() {
            let s = &bound.scopes[scope.idx()];
            match s.kind {
                // A signature is no scope for blocks.
                ScopeKind::Fn(f)
                    if matches!(
                        hir[f].kind,
                        FnKind::CallSignature
                            | FnKind::ConstructSignature
                            | FnKind::FunctionType
                            | FnKind::ConstructorType
                            | FnKind::IndexSignature
                    ) || matches!(bound.fns[f.idx()].owner, FnOwner::Member(m) if !matches!(bound.member_owner[m.idx()], MemberOwner::Class(_))) =>
                    {}
                ScopeKind::Fn(f) => return Some(Container::Fn(f)),
                ScopeKind::File | ScopeKind::Module(_) => return Some(Container::Top),
                // Which block, or which property of the class, is not kept track of.
                ScopeKind::Block | ScopeKind::Class(_) => return None,
                _ => {}
            }
            scope = s.parent;
        }
        None
    }

    /// `GetContainingClass`
    fn class_containing(&self, file: FileId, e: ExprId) -> Option<ClassId> {
        self.class_around(file, Parent::Expr(e))
    }

    /// `GetContainingClass` of `node`, an expression or a statement.
    fn class_around(&self, file: FileId, node: Parent) -> Option<ClassId> {
        let bound = self.bound(file);
        let class_of = |m: MemberId| match bound.member_owner[m.idx()] {
            MemberOwner::Class(c) => Some(c),
            _ => None,
        };
        // The expression the walk left last.
        let mut below = ExprId::NONE;
        let mut parent = node;
        loop {
            parent = match parent {
                Parent::Expr(x) if x.is_none() => return None,
                Parent::Expr(x) => {
                    below = x;
                    bound.expr_parent[x.idx()]
                }
                Parent::MemberInit(m) => return class_of(m),
                Parent::ClassExtends(c) | Parent::Decorator(c, _) => return Some(c),
                Parent::FnBody(_) | Parent::ParamDefault(_) => {
                    let f = match parent {
                        Parent::FnBody(f) => f,
                        Parent::ParamDefault(p) => bound.param_fn[p.idx()],
                        _ => unreachable!(),
                    };
                    match bound.fns[f.idx()].owner {
                        FnOwner::Member(m) => return class_of(m),
                        _ => self.outward(file, parent),
                    }
                }
                Parent::Key(_) | Parent::MemberKey => match self.what_is_named(file, parent, below)
                {
                    Named::Property(literal) | Named::Function(literal) => Parent::Expr(literal),
                    Named::Element(p) => self.outward(file, Parent::PatPropDefault(p)),
                    Named::Member(m) => return class_of(m),
                    Named::Unknown => return None,
                },
                Parent::EnumInit(m) => {
                    match self.stmt_of_enum(file, bound.enum_member_owner[m.idx()]) {
                        Some(s) => Parent::Stmt(s),
                        None => return None,
                    }
                }
                Parent::None | Parent::File | Parent::Module(_) => return None,
                Parent::Stmt(s) if s.is_none() => return None,
                _ => self.outward(file, parent),
            };
        }
    }

    /// Declared further up, the variable `pat` of the declaration `decl` is still not there in that declaration itself:
    /// `let a = a`, `let [a = a] = []`, `for (const a of a)`.
    fn is_not_used_within_its_declaration(
        &self,
        file: FileId,
        e: ExprId,
        pat: PatId,
        decl: VarDeclId,
        runs_in_place: bool,
    ) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // An expression is numbered after all that is written in it, and the initializer after the pattern. What comes later still is
        // not in the declaration, unless it is what a loop goes through.
        let (init, stmt) = (hir[decl].init, bound.var_stmt[decl.idx()]);
        if init.is_some()
            && e.0 > init.0
            && stmt.is_some()
            && !matches!(bound.stmt_parent[stmt.idx()], Parent::Stmt(around) if around.is_some()
                && matches!(hir[around].kind, StmtKind::ForIn { .. } | StmtKind::ForOf { .. }))
        {
            return true;
        }
        // Of an element of a pattern: the nearest element around the use, whatever else is in between, has to be another.
        if !matches!(bound.pat_parent[pat.idx()], PatParent::Var(_)) {
            let mut below = e;
            let mut parent = bound.expr_parent[e.idx()];
            loop {
                parent = match parent {
                    Parent::PatPropDefault(p) => return hir[p].value != pat,
                    Parent::PatElemDefault(p) => return hir[p].pat != pat,
                    Parent::Expr(x) if x.is_none() => return true,
                    Parent::Expr(x) => {
                        below = x;
                        bound.expr_parent[x.idx()]
                    }
                    Parent::Key(_) | Parent::MemberKey => {
                        match self.what_is_named(file, parent, below) {
                            Named::Element(p) => return hir[p].value != pat,
                            Named::Property(literal) | Named::Function(literal) => {
                                Parent::Expr(literal)
                            }
                            Named::Member(m) => self.parent_of(file, Parent::MemberInit(m)),
                            Named::Unknown => return true,
                        }
                    }
                    Parent::File | Parent::Module(_) => break,
                    Parent::None | Parent::EnumInit(_) => return true,
                    Parent::Stmt(s) if s.is_none() => return true,
                    Parent::Stmt(s) => bound.stmt_parent[s.idx()],
                    _ => self.outward(file, parent),
                };
            }
        }
        // `isImmediatelyUsedInInitializerOfBlockScopedVariable`
        let mut below = Parent::Expr(e);
        let mut parent = bound.expr_parent[e.idx()];
        loop {
            let around = match parent {
                Parent::VarInit(d) if d == decl => return false,
                // `isSameScopeDescendentOf`: a function ends the search, unless it is called where it is written and is neither
                // `async` nor a generator.
                Parent::FnBody(_) | Parent::ParamDefault(_) => {
                    let f = match parent {
                        Parent::FnBody(f) => f,
                        Parent::ParamDefault(p) => bound.param_fn[p.idx()],
                        _ => unreachable!(),
                    };
                    if hir[f].kind != FnKind::StaticBlock
                        && (!self.is_immediately_invoked(file, f)
                            || hir[f].flags.intersects(Flags::ASYNC | Flags::GENERATOR))
                    {
                        return true;
                    }
                    self.outward(file, parent)
                }
                // What decorates a method, an accessor or a parameter is in the function.
                Parent::Decorator(_, DecoratorOwner::Param(_)) => return true,
                Parent::Decorator(_, DecoratorOwner::Member(m)) if hir[m].func.is_some() => {
                    return true;
                }
                // What is gone through is looked at before there is anything to bind.
                Parent::Stmt(s) if s.is_some() => {
                    if let StmtKind::ForIn { left, expr, .. } | StmtKind::ForOf { left, expr, .. } =
                        hir[s].kind
                        && below == Parent::Expr(expr)
                        && bound.var_stmt[decl.idx()] == left
                    {
                        return false;
                    }
                    // Around a statement are statements, and then a function that ends the search, a namespace or the file.
                    if !runs_in_place {
                        return true;
                    }
                    bound.stmt_parent[s.idx()]
                }
                Parent::Key(_) | Parent::MemberKey => {
                    let Parent::Expr(key) = below else {
                        return true;
                    };
                    match self.what_is_named(file, parent, key) {
                        Named::Property(literal) => Parent::Expr(literal),
                        Named::Element(p) => self.outward(file, Parent::PatPropDefault(p)),
                        // The name of a property of a class is worked out with the class; that of a method or an accessor is in
                        // the function.
                        Named::Member(m) if hir[m].kind == MemberKind::Property => {
                            self.parent_of(file, Parent::MemberInit(m))
                        }
                        _ => return true,
                    }
                }
                Parent::Expr(x) if x.is_none() => return true,
                Parent::Expr(x) => bound.expr_parent[x.idx()],
                Parent::None | Parent::File | Parent::Module(_) | Parent::EnumInit(_) => {
                    return true;
                }
                _ => self.outward(file, parent),
            };
            below = parent;
            parent = around;
        }
    }

    /// `class A { [A.p]() {} }`: whether `e` is in the computed name of a member of the class `c`, however deep.
    fn is_in_computed_name_of(&self, file: FileId, e: ExprId, c: ClassId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if !hir[c]
            .members
            .iter()
            .any(|m| matches!(hir[m].key, PropKey::Computed(_)))
        {
            return false;
        }
        let mut below = e;
        let mut parent = bound.expr_parent[e.idx()];
        loop {
            parent = match parent {
                Parent::Expr(x) if x.is_none() => return false,
                Parent::Expr(x) => {
                    below = x;
                    bound.expr_parent[x.idx()]
                }
                Parent::Key(_) | Parent::MemberKey => match self.what_is_named(file, parent, below)
                {
                    Named::Property(literal) | Named::Function(literal) => Parent::Expr(literal),
                    Named::Element(p) => self.outward(file, Parent::PatPropDefault(p)),
                    // The name of a `declare` member is ambient, and an ambient use counts as declared (`isInAmbientOrTypeNode`).
                    Named::Member(m) if bound.member_owner[m.idx()] == MemberOwner::Class(c) => {
                        return !hir[m].flags.contains(Flags::AMBIENT);
                    }
                    Named::Member(m) => self.parent_of(file, Parent::MemberInit(m)),
                    Named::Unknown => return false,
                },
                Parent::None | Parent::File | Parent::Module(_) | Parent::EnumInit(_) => {
                    return false;
                }
                Parent::Stmt(s) if s.is_none() => return false,
                _ => self.outward(file, parent),
            };
        }
    }

    /// `isUsedInFunctionOrInstanceProperty`, of what is no member of a class, is directly in `around` and comes after the use `e`.
    fn is_use_deferred_in(&self, file: FileId, e: ExprId, around: Parent) -> bool {
        match self.block_scope_around(file, around) {
            Some(container) => self.is_use_deferred(file, e, Declaration::further_down(container)),
            // Where it is declared is lost track of.
            None => true,
        }
    }

    /// `isUsedInFunctionOrInstanceProperty`: by the time the use `e` is reached, what is declared may be there after all. What is
    /// only declared uses nothing (`isInAmbientOrTypeNode`); and where the way out is lost track of, the answer is yes.
    fn is_use_deferred(&self, file: FileId, e: ExprId, declaration: Declaration) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let container = declaration.container;
        // The expression last gone out of.
        let mut below = e;
        let mut parent = bound.expr_parent[e.idx()];
        loop {
            parent = match parent {
                Parent::Expr(x) if x.is_none() => return true,
                Parent::Expr(x) => {
                    below = x;
                    bound.expr_parent[x.idx()]
                }
                Parent::FnBody(_) | Parent::ParamDefault(_) => {
                    let f = match parent {
                        Parent::FnBody(f) => f,
                        Parent::ParamDefault(p) => bound.param_fn[p.idx()],
                        _ => unreachable!(),
                    };
                    if container == Container::Fn(f) {
                        return false;
                    }
                    if hir[f].kind == FnKind::StaticBlock {
                        if declaration.is_before {
                            return true;
                        }
                    } else if !self.is_immediately_invoked(file, f) {
                        return true;
                    }
                    self.outward(file, parent)
                }
                Parent::MemberInit(m) => {
                    if hir[m].flags.contains(Flags::AMBIENT) {
                        return true;
                    }
                    if hir[m].flags.contains(Flags::STATIC) {
                        if declaration.is_method || declaration.is_set_in_static_blocks {
                            return true;
                        }
                    } else if !declaration.is_own_instance_property {
                        return true;
                    }
                    if container == Container::Property(m) {
                        return false;
                    }
                    self.outward(file, parent)
                }
                // What decorates a method or a parameter is worked out with the class; what decorates an accessor is in the function.
                Parent::Decorator(_, DecoratorOwner::Member(m))
                    if matches!(hir[m].kind, MemberKind::Getter | MemberKind::Setter) =>
                {
                    return true;
                }
                Parent::Decorator(_, DecoratorOwner::Member(m))
                    if container == Container::Property(m) =>
                {
                    return false;
                }
                Parent::ClassExtends(c) if hir[c].flags.contains(Flags::AMBIENT) => return true,
                Parent::VarInit(d) if hir[d].flags.contains(Flags::AMBIENT) => return true,
                Parent::EnumInit(m) => {
                    let en = bound.enum_member_owner[m.idx()];
                    if hir[en].flags.contains(Flags::AMBIENT) {
                        return true;
                    }
                    match self.stmt_of_enum(file, en) {
                        Some(s) => Parent::Stmt(s),
                        None => return true,
                    }
                }
                Parent::Key(_) | Parent::MemberKey => match self.what_is_named(file, parent, below)
                {
                    Named::Property(literal) => Parent::Expr(literal),
                    Named::Element(p) => self.outward(file, Parent::PatPropDefault(p)),
                    // The name of a property of a class is worked out with the class; that of a method or an accessor is in the
                    // function.
                    Named::Member(m) => match bound.member_owner[m.idx()] {
                        MemberOwner::Class(c)
                            if hir[m].kind == MemberKind::Property
                                && !hir[c].flags.contains(Flags::AMBIENT) =>
                        {
                            if container == Container::Property(m) {
                                return false;
                            }
                            self.outward(file, Parent::ClassExtends(c))
                        }
                        _ => return true,
                    },
                    Named::Function(_) | Named::Unknown => return true,
                },
                Parent::Stmt(s) if s.is_none() => return true,
                Parent::Stmt(s) if container == Container::Stmt(s) => return false,
                Parent::File => return false,
                Parent::Module(m) => return hir[m].flags.contains(Flags::AMBIENT),
                Parent::None => return true,
                _ => self.outward(file, parent),
            };
        }
    }

    /// `isPropertyImmediatelyReferencedWithinDeclaration`, of the property `declaration` (`NONE`: a parameter property) of `class`,
    /// which the use `e` does not come after the end of.
    fn is_property_immediately_referenced(
        &self,
        file: FileId,
        e: ExprId,
        declaration: MemberId,
        class: ClassId,
        stop_at_any: bool,
    ) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // The property in question ends the search; any other decides it.
        let at_property = |m: MemberId| {
            m == declaration
                || stop_at_any && bound.member_owner[m.idx()] == MemberOwner::Class(class)
        };
        let mut below = e;
        let mut parent = bound.expr_parent[e.idx()];
        loop {
            parent = match parent {
                Parent::Expr(x) if x.is_none() => return false,
                Parent::Expr(x) => {
                    below = x;
                    bound.expr_parent[x.idx()]
                }
                Parent::MemberInit(m) => return at_property(m),
                Parent::Decorator(_, DecoratorOwner::Member(m))
                    if hir[m].kind == MemberKind::Property =>
                {
                    return at_property(m);
                }
                // An arrow function, and the body of a method or an accessor, run later.
                Parent::FnBody(f)
                    if matches!(
                        hir[f].kind,
                        FnKind::Arrow | FnKind::Method | FnKind::Getter | FnKind::Setter
                    ) =>
                {
                    return false;
                }
                Parent::ParamDefault(p) if hir[bound.param_fn[p.idx()]].kind == FnKind::Arrow => {
                    return false;
                }
                Parent::Key(_) | Parent::MemberKey => match self.what_is_named(file, parent, below)
                {
                    Named::Property(literal) | Named::Function(literal) => Parent::Expr(literal),
                    Named::Element(p) => self.outward(file, Parent::PatPropDefault(p)),
                    Named::Member(m) if hir[m].kind == MemberKind::Property => {
                        return at_property(m);
                    }
                    Named::Member(m) => self.parent_of(file, Parent::MemberInit(m)),
                    Named::Unknown => return false,
                },
                // All the way out. A use that is not in the declaration comes after it, unless the declaration is further down.
                Parent::File | Parent::Module(_) => return stop_at_any,
                Parent::None | Parent::EnumInit(_) => return false,
                Parent::Stmt(s) if s.is_none() => return false,
                _ => self.outward(file, parent),
            };
        }
    }

    /// `checkPropertyNotUsedBeforeDeclaration`: 2729 2449. `has_static_block`: whether there is one in the file.
    fn check_property_not_used_before_declaration(
        &mut self,
        file: FileId,
        e: ExprId,
        obj: ExprId,
        name: Atom,
        name_pos: u32,
        has_static_block: bool,
        out: &mut Vec<Diagnostic>,
    ) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if bound.is_in_type_query(e) {
            return;
        }
        let class_of = |m: MemberId| match bound.member_owner[m.idx()] {
            MemberOwner::Class(c) => Some(c),
            _ => None,
        };
        // `isInPropertyInitializerOrClassStaticBlock`; and which property, if it is in the initializer or in a decorator of one.
        // An ambient use counts as declared (`isInAmbientOrTypeNode` in `isBlockScopedNameDeclaredBeforeUse`): no error is reported.
        let (mut initializer_of, mut decorator_of) = (MemberId::NONE, MemberId::NONE);
        // The class whose method or parameter the use decorates: `isUsedInFunctionOrInstanceProperty` restarts with that class as
        // the use.
        let mut decorated_class = None;
        let mut below = e;
        let mut parent = bound.expr_parent[e.idx()];
        let is_in_property = loop {
            parent = match parent {
                Parent::Expr(x) if x.is_none() => break false,
                Parent::Expr(x) => {
                    // The name in a closing tag.
                    if let ExprKind::Jsx(j) = hir[x].kind
                        && hir[j].close_tag == below
                    {
                        break false;
                    }
                    below = x;
                    bound.expr_parent[x.idx()]
                }
                Parent::MemberInit(m) if hir[m].flags.contains(Flags::AMBIENT) => return,
                Parent::ClassExtends(c) if hir[c].flags.contains(Flags::AMBIENT) => return,
                Parent::VarInit(d) if hir[d].flags.contains(Flags::AMBIENT) => return,
                Parent::MemberInit(m) => {
                    initializer_of = m;
                    break true;
                }
                Parent::Decorator(_, DecoratorOwner::Member(m))
                    if hir[m].kind == MemberKind::Property =>
                {
                    decorator_of = m;
                    break true;
                }
                Parent::Decorator(c, DecoratorOwner::Member(m))
                    if hir[m].kind == MemberKind::Method =>
                {
                    decorated_class = Some(c);
                    self.outward(file, parent)
                }
                Parent::Decorator(c, DecoratorOwner::Param(_)) => {
                    decorated_class = Some(c);
                    self.outward(file, parent)
                }
                Parent::FnBody(f) if hir[f].kind == FnKind::StaticBlock => break true,
                // An arrow function, and the body of any other function.
                Parent::FnBody(_) => break false,
                Parent::ParamDefault(p) if hir[bound.param_fn[p.idx()]].kind == FnKind::Arrow => {
                    break false;
                }
                Parent::Key(_) | Parent::MemberKey => match self.what_is_named(file, parent, below)
                {
                    Named::Property(literal) | Named::Function(literal) => Parent::Expr(literal),
                    Named::Element(p) => self.outward(file, Parent::PatPropDefault(p)),
                    Named::Member(m) => match class_of(m) {
                        // A member of an interface or a type literal.
                        None => return,
                        Some(_) if hir[m].flags.contains(Flags::AMBIENT) => return,
                        Some(_) if hir[m].kind == MemberKind::Property => break true,
                        Some(c) => self.outward(file, Parent::ClassExtends(c)),
                    },
                    Named::Unknown => break false,
                },
                // An enum member and its enum are ordinary ancestors.
                Parent::EnumInit(m) => {
                    let en = bound.enum_member_owner[m.idx()];
                    if hir[en].flags.contains(Flags::AMBIENT) {
                        return;
                    }
                    match self.stmt_of_enum(file, en) {
                        Some(s) => Parent::Stmt(s),
                        None => break false,
                    }
                }
                Parent::None | Parent::File | Parent::Module(_) => break false,
                // Around a statement are statements, and then the body of a function, a namespace or the file.
                Parent::Stmt(s) if s.is_none() || !has_static_block => break false,
                Parent::Stmt(s) => bound.stmt_parent[s.idx()],
                _ => self.outward(file, parent),
            };
        };
        // Where the use starts, for `isUsedInFunctionOrInstanceProperty`.
        let use_pos = decorated_class.map_or(name_pos, |c: ClassId| hir[c].pos);
        // In parentheses it is another kind of expression.
        let is_bare = !is_parenthesized(hir, obj);
        // Of `a.b.c` only `a.b` is looked at for 2729.
        let is_in_place = is_in_property
            && !(is_bare && matches!(hir[obj].kind, ExprKind::Dot { .. } | ExprKind::Index { .. }));
        // Elsewhere only a class declaration counts, one that a namespace exports.
        if !is_in_place && hir.classes.is_empty() {
            return;
        }
        let object = self.type_of_expr(file, obj);
        if !is_in_place
            && !matches!(
                self.data(object),
                TypeData::Anon {
                    origin: Origin::Module(_)
                        | Origin::Namespace { .. }
                        | Origin::ClassStatic(_)
                        | Origin::Function(_)
                        | Origin::EnumObject(_),
                    ..
                }
            )
        {
            return;
        }
        if !self.is_known(object) || self.is_uncertain(file, obj) {
            return;
        }
        let object = self.apparent_type(object);
        let Some((prop, mapper)) = self.prop_ref(object, name) else {
            return;
        };
        let emit = self.p.files.options.emit_standard_class_fields;
        // The class `prop.Parent` is, and the class declaration `prop.ValueDeclaration` is.
        let (mut declaring_class, mut class_declaration) = (None, None);
        // Where `GetErrorRangeForNode(prop.ValueDeclaration)` starts.
        let declared_at;
        // `isBlockScopedNameDeclaredBeforeUse(prop.ValueDeclaration, right)`
        let is_declared = match prop.source {
            PropSource::Members(ref members) => {
                let Some(&(declared_in, md)) = members.first() else {
                    return;
                };
                if !is_in_place || declared_in != file {
                    return;
                }
                let decl = &hir[md];
                declared_at = decl.pos;
                match class_of(md) {
                    // Of an interface or a type literal.
                    None => {
                        let container = match bound.member_owner[md.idx()] {
                            MemberOwner::Interface(i) => {
                                match bound.scopes.get(bound.interface_scope[i.idx()].idx()) {
                                    Some(s) => self.block_scope_around_type_in(file, s.parent),
                                    None => None,
                                }
                            }
                            MemberOwner::TypeLiteral(t) => {
                                self.block_scope_around_type_in(file, bound.type_scope[t.idx()])
                            }
                            _ => None,
                        };
                        let Some(container) = container else { return };
                        decl.pos <= name_pos
                            || self.is_use_deferred(file, e, Declaration::further_down(container))
                    }
                    Some(class) => {
                        declaring_class = Some(class);
                        match decl.kind {
                            // `isOptionalPropertyDeclaration`
                            MemberKind::Property
                                if decl.flags.contains(Flags::OPTIONAL)
                                    && !decl.flags.contains(Flags::ACCESSOR) =>
                            {
                                return;
                            }
                            MemberKind::Method if decl.flags.contains(Flags::STATIC) => return,
                            MemberKind::Property
                            | MemberKind::Method
                            | MemberKind::Getter
                            | MemberKind::Setter => {}
                            _ => return,
                        }
                        let is_property = decl.kind == MemberKind::Property;
                        let is_this = is_bare && matches!(hir[obj].kind, ExprKind::This);
                        // Its decorators come before its name.
                        let starts_before = decl.pos <= name_pos || decorator_of == md;
                        if starts_before
                            && !(is_property
                                && is_this
                                && decl.init.is_none()
                                && !decl.flags.contains(Flags::DEFINITE))
                        {
                            // `x = this.x`
                            !is_property
                                || !self
                                    .is_property_immediately_referenced(file, e, md, class, false)
                        } else {
                            let Some(container) = self.block_scope_around(
                                file,
                                self.outward(file, Parent::ClassExtends(class)),
                            ) else {
                                return;
                            };
                            let use_class = match decorated_class {
                                Some(c) => self.class_around(
                                    file,
                                    self.outward(file, Parent::ClassExtends(c)),
                                ),
                                None => self.class_containing(file, e),
                            };
                            let is_same_class = use_class == Some(class);
                            // `isPropertyInitializedInStaticBlocks`. With standard class fields a property declared after the use is
                            // an error whatever the static blocks assign (`isPropertyImmediatelyReferencedWithinDeclaration`).
                            let mut is_set_in_static_blocks = false;
                            if (!emit || decl.pos <= name_pos)
                                && is_property
                                && is_same_class
                                && initializer_of.is_some()
                                && hir[initializer_of].flags.contains(Flags::STATIC)
                                && (matches!(decl.key, PropKey::Private(_))
                                    || matches!(decl.key, PropKey::Name(_))
                                        && !decl
                                            .flags
                                            .intersects(Flags::LITERAL_NAME | Flags::STRING_NAME))
                            {
                                // Static blocks run in document order: only those before the initializer count.
                                let end = self.start_of(file, hir[initializer_of].init);
                                let is_in_range = |b: MemberId| {
                                    hir[b].kind == MemberKind::StaticBlock && hir[b].pos <= end
                                };
                                // Without such a block the answer is no, whatever the type of the property.
                                if hir[class].members.iter().any(|b| is_in_range(b)) {
                                    let ty = self.type_of_prop(prop, mapper);
                                    if !self.is_known(ty) {
                                        return;
                                    }
                                    for b in hir[class].members.iter().filter(|&b| is_in_range(b)) {
                                        let block = hir[b].func;
                                        // The exit of the block is unknown.
                                        if block.is_none() || bound.fns[block.idx()].exit.is_none()
                                        {
                                            return;
                                        }
                                        if self.is_assigned_in_constructor(file, block, name, ty) {
                                            is_set_in_static_blocks = true;
                                            break;
                                        }
                                    }
                                }
                            }
                            let declaration = Declaration {
                                container,
                                is_before: decl.pos < use_pos,
                                is_method: decl.kind == MemberKind::Method,
                                is_own_instance_property: is_property
                                    && !decl.flags.contains(Flags::STATIC)
                                    && is_same_class,
                                is_set_in_static_blocks,
                            };
                            self.is_use_deferred(file, e, declaration)
                                && !(emit
                                    && is_property
                                    && decl.pos > name_pos
                                    && self.is_property_immediately_referenced(
                                        file, e, md, class, true,
                                    ))
                        }
                    }
                }
            }
            PropSource::Parameter(declared_in, p) => {
                if !is_in_place || declared_in != file {
                    return;
                }
                declared_at = hir[p].pos;
                let constructor = bound.param_fn[p.idx()];
                let FnOwner::Member(member) = bound.fns[constructor.idx()].owner else {
                    return;
                };
                let Some(class) = class_of(member) else {
                    return;
                };
                declaring_class = Some(class);
                let declaration = Declaration {
                    is_before: hir[p].pos < use_pos,
                    ..Declaration::further_down(Container::Fn(constructor))
                };
                let is_used_later = self.is_use_deferred(file, e, declaration);
                if hir[p].pos <= name_pos {
                    // With fields as they are written, they are set before the constructor gets to its parameters.
                    !(emit && is_used_later && self.class_containing(file, e) == Some(class))
                } else {
                    is_used_later
                        && !(emit
                            && self.is_property_immediately_referenced(
                                file,
                                e,
                                MemberId::NONE,
                                class,
                                true,
                            ))
                }
            }
            PropSource::Symbol(s) => {
                let decls = self.files().decls_of(self.files().canonical(s));
                // `SetValueDeclaration`: the first that declares a value, a namespace only if nothing else does. An alias declares none.
                let Some(&(declared_in, decl)) = decls
                    .iter()
                    .find(|d| {
                        matches!(
                            d.1,
                            Decl::Var(_)
                                | Decl::Fn(_)
                                | Decl::Class(_)
                                | Decl::Enum(_)
                                | Decl::EnumMember(_)
                        )
                    })
                    .or_else(|| decls.iter().find(|d| matches!(d.1, Decl::Module(_))))
                else {
                    return;
                };
                if declared_in != file || !is_in_place && !matches!(decl, Decl::Class(_)) {
                    return;
                }
                declared_at = match decl {
                    Decl::Class(c) => hir[c].name_pos,
                    Decl::Var(pat) => hir[pat].pos,
                    Decl::Fn(f) => hir[f].name_pos,
                    Decl::Enum(en) => hir[en].name_pos,
                    Decl::EnumMember(m) => hir[m].pos,
                    Decl::Module(m) => hir[m].name_pos,
                    _ => return,
                };
                match decl {
                    Decl::Class(c) => {
                        class_declaration = Some(c);
                        self.is_class_declared_before_use(file, e, c, name_pos)
                    }
                    Decl::Var(pat) => {
                        let Some(d) = self.variable_declaration_of(file, pat) else {
                            return;
                        };
                        self.is_variable_declared_before_use(file, e, name_pos, pat, d, true)
                    }
                    Decl::Fn(f) => {
                        let FnOwner::Stmt(s) = bound.fns[f.idx()].owner else {
                            return;
                        };
                        hir[f].pos <= name_pos || self.is_use_deferred_in(file, e, Parent::Stmt(s))
                    }
                    Decl::Enum(_) | Decl::EnumMember(_) => {
                        let (en, start) = match decl {
                            Decl::EnumMember(m) => (bound.enum_member_owner[m.idx()], hir[m].pos),
                            Decl::Enum(en) => (en, hir[en].name_pos),
                            _ => unreachable!(),
                        };
                        if start <= name_pos {
                            return;
                        }
                        let Some(s) = self.stmt_of_enum(file, en) else {
                            return;
                        };
                        self.is_use_deferred_in(file, e, Parent::Stmt(s))
                    }
                    Decl::Module(m) => {
                        hir[m].name_pos <= name_pos
                            || self.is_use_deferred(
                                file,
                                e,
                                Declaration::further_down(Container::Top),
                            )
                    }
                    _ => return,
                }
            }
            PropSource::Literal(declared_in, p) => {
                if !is_in_place || declared_in != file {
                    return;
                }
                if hir[p].pos <= name_pos {
                    return;
                }
                declared_at = hir[p].pos;
                let Some(container) = self.block_scope_around(file, Parent::Prop(p)) else {
                    return;
                };
                self.is_use_deferred(
                    file,
                    e,
                    Declaration {
                        is_method: hir[p].kind == PropKind::Method,
                        ..Declaration::further_down(container)
                    },
                )
            }
            PropSource::Assigned(declared_in, ref assignments) => {
                let Some(&first) = assignments.first() else {
                    return;
                };
                if !is_in_place || declared_in != file {
                    return;
                }
                declared_at = self.start_of(file, first);
                declared_at <= name_pos
                    || self.is_use_deferred_in(file, e, bound.expr_parent[first.idx()])
            }
            _ => return,
        };
        if is_declared {
            return;
        }
        if is_in_place {
            // `isPropertyDeclaredInAncestorClass`: of what a class declares.
            let mut is_inherited = false;
            if !self.p.files.options.use_define_for_class_fields
                && let Some(c) = declaring_class
            {
                let sym = self.files().sym(file, bound.class_symbol[c.idx()]);
                if let Some(&base) = self.base_types(sym).first() {
                    let base = self.apparent_type(base);
                    if let Some((base_prop, _)) = self.prop_of(base, name)
                        && Self::value_declaration(&base_prop).is_some()
                    {
                        is_inherited = true;
                    }
                }
            }
            if !is_inherited {
                out.push(Diagnostic {
                    start: name_pos,
                    code: 2729,
                });
                self.explain_property_used_early(file, name_pos, 2729, prop, declared_at);
                return;
            }
        }
        if let Some(c) = class_declaration
            && !hir[c].flags.contains(Flags::AMBIENT)
        {
            out.push(Diagnostic {
                start: name_pos,
                code: 2449,
            });
            self.explain_property_used_early(file, name_pos, 2449, prop, declared_at);
        }
    }

    /// What `checkPropertyNotUsedBeforeDeclaration` says of the name written at `start`: the name, and where `prop.ValueDeclaration` is,
    /// which is in `file` and starts at `declared_at`.
    fn explain_property_used_early(
        &mut self,
        file: FileId,
        start: u32,
        code: u32,
        prop: &Prop,
        declared_at: u32,
    ) {
        self.explain(start, code, |c| vec![c.declaration_name_at(file, start)]);
        self.relate(start, code, |c| {
            // `GetErrorRangeForNode`: all of a parameter, of `a: 1` and of `this.a = 1`. Of anything else its name.
            let declared_to = match prop.source {
                PropSource::Parameter(_, p) => c.end_of_param(file, p),
                PropSource::Literal(_, p)
                    if matches!(c.hir(file)[p].kind, PropKind::Init | PropKind::Shorthand) =>
                {
                    c.end_of_prop(file, p)
                }
                PropSource::Assigned(_, ref assignments) => c.end_of_expr(file, assignments[0]),
                _ => c.end_of_name_at(file, declared_at),
            };
            let name = c.declaration_name_at(file, start);
            vec![c.declared_here((file, declared_at, declared_to), name)]
        });
    }
}

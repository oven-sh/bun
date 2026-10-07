//! Contextual typing: the type an expression is expected to have, determined by its syntactic
//! position.

use super::infer::{Inference, Parts};
use super::shape::{IgnoreReturnTypes, IgnoreThisTypes, PartialMatch};
use super::symbols::IterationUse;
use super::*;
use crate::bind::{Decl, FnOwner, Parent, PatParent};
use smallvec::SmallVec;

/// The names of the discriminant properties of a union, each with the type of the value given for
/// it.
type Discriminants = SmallVec<[(Atom, TypeId); 8]>;

/// `includePatternInType` of `getTypeFromBindingPattern`: the type is the contextual type of the
/// initializer of the pattern.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum IncludePatternInType {
    No,
    Yes,
}

/// `reportErrors`
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum ReportErrors {
    No,
    Yes,
}

impl<'p, 's> Checker<'p, 's> {
    /// `getContainingFunctionOrClassStaticBlock`
    #[inline]
    pub fn enclosing_fn_of_expr(&self, file: FileId, e: ExprId) -> Option<FnId> {
        self.enclosing_fn(file, self.bound(file).expr_parent[e.idx()])
    }

    /// The same for a direct child of `parent`.
    pub fn enclosing_fn(&self, file: FileId, mut parent: Parent) -> Option<FnId> {
        let bound = self.bound(file);
        loop {
            parent = match parent {
                // FOR SPEED: most steps are these two.
                Parent::Expr(e) if e.is_some() => bound.expr_parent[e.idx()],
                Parent::Stmt(s) if s.is_some() => bound.stmt_parent[s.idx()],
                Parent::FnBody(f) => return Some(f),
                Parent::ParamDefault(p) => return Some(bound.param_fn[p.idx()]),
                Parent::None | Parent::File => return None,
                _ => self.parent_of_node(file, parent),
            };
        }
    }

    /// Resolves the calls that determine the parameter types of the functions enclosing `e`,
    /// outermost first, so that a query about something inside does not become circular through
    /// them.
    pub fn prepare_enclosing(&mut self, file: FileId, e: ExprId) {
        self.prepare_around(file, e);
        self.prepare_context(file, e);
    }

    /// `prepare_parent` for the ancestors of `e`. In the file being checked, `e` and its ancestor
    /// expressions are marked on the way up. A descendant of a marked expression is in the same
    /// function, which has already been through `prepare_from_the_outside`.
    fn prepare_around(&mut self, file: FileId, e: ExprId) {
        let bound = self.bound(file);
        if self.prepared_exprs.0 != file {
            if self.task.file != Some(file) {
                return self.prepare_parent(file, bound.expr_parent[e.idx()]);
            }
            self.prepared_exprs = (file, vec![false; bound.expr_parent.len()]);
        }
        let mut at = e;
        while !std::mem::replace(&mut self.prepared_exprs.1[at.idx()], true) {
            at = match bound.expr_parent[at.idx()] {
                Parent::Expr(parent) => parent,
                Parent::Prop(p) => bound.prop_owner[p.idx()],
                parent => return self.prepare_parent(file, parent),
            };
        }
    }

    /// The same for a query about the parameters or the return type of `func`.
    pub fn prepare_fn(&mut self, file: FileId, func: FnId) {
        self.prepare_parent(file, Parent::FnBody(func));
    }

    pub fn prepare_parent(&mut self, file: FileId, parent: Parent) {
        if let Some(func) = self.enclosing_fn(file, parent) {
            self.prepare_from_the_outside(file, func);
        }
    }

    /// The functions enclosing `func` first. For a function that has been through here, all of them
    /// are already prepared.
    fn prepare_from_the_outside(&mut self, file: FileId, func: FnId) {
        // Consecutive queries are about the same function.
        if self.last_prepared == (file, func) || !self.prepared.insert((file, func)) {
            self.last_prepared = (file, func);
            return;
        }
        let info = &self.bound(file).fns[func.idx()];
        let (enclosing, owner) = (info.enclosing, info.owner);
        if enclosing.is_some() {
            self.prepare_from_the_outside(file, enclosing);
        }
        if let FnOwner::Expr(owner) = owner {
            self.prepare_context(file, owner);
        }
        self.last_prepared = (file, func);
    }

    /// If `e` is (part of) an argument, resolves the call.
    pub(super) fn prepare_context(&mut self, file: FileId, e: ExprId) {
        let hir = self.hir(file);
        let bound = self.bound(file);
        let mut at = e;
        for _ in 0..64 {
            match bound.expr_parent[at.idx()] {
                Parent::Expr(parent) => match hir[parent].kind {
                    ExprKind::Call(c) | ExprKind::New(c) => {
                        if hir[c].callee != at
                            && self.p.calls.get(&self.task, &(file, parent)).is_none()
                            && !self.stack.contains(&Query::Call(file, parent))
                        {
                            // The call may be an argument itself: resolve the outermost enclosing call first. As the outermost query,
                            // `resolved_signature` does that itself. Doing it twice doubles the work per nesting level if the enclosing
                            // calls are non-cacheable.
                            if !self.is_top_level_query() {
                                self.prepare_context(file, parent);
                            }
                            self.resolved_signature(file, parent);
                        }
                        return;
                    }
                    ExprKind::Jsx(_) => {
                        self.prepare_jsx(file, parent);
                        return;
                    }
                    ExprKind::Array(_)
                    | ExprKind::Spread(_)
                    | ExprKind::NonNull(_)
                    | ExprKind::AsConst(_)
                    | ExprKind::Satisfies { .. }
                    | ExprKind::Await(_) => at = parent,
                    ExprKind::Cond { test, .. } if test != at => at = parent,
                    ExprKind::Binary {
                        op: BinOp::Or | BinOp::Nullish | BinOp::And | BinOp::Comma,
                        ..
                    } => at = parent,
                    _ => return,
                },
                Parent::Prop(p) => {
                    let owner = bound.prop_owner[p.idx()];
                    if let ExprKind::Jsx(_) = hir[owner].kind {
                        self.prepare_jsx(file, owner);
                        return;
                    }
                    at = owner;
                }
                Parent::FnBody(f) => match bound.fns[f.idx()].owner {
                    FnOwner::Expr(owner) => at = owner,
                    _ => return,
                },
                Parent::Stmt(s) if matches!(hir[s].kind, StmtKind::Return(_)) => {
                    match self
                        .enclosing_fn(file, Parent::Stmt(s))
                        .map(|f| bound.fns[f.idx()].owner)
                    {
                        Some(FnOwner::Expr(owner)) => at = owner,
                        _ => return,
                    }
                }
                _ => return,
            }
        }
    }

    /// Resolves what the component of the JSX element `e` accepts, after whatever encloses the
    /// element.
    fn prepare_jsx(&mut self, file: FileId, e: ExprId) {
        if self.p.calls.get(&self.task, &(file, e)).is_none()
            && !self.stack.contains(&Query::Call(file, e))
        {
            self.prepare_context(file, e);
            self.resolved_signature(file, e);
        }
    }

    /// The same, as the contextual type of the pattern's initializer. The names of the pattern that
    /// its own defaults reference have type `any` in the meantime: their types depend on the
    /// initializer.
    pub(super) fn context_implied_by_pattern(
        &mut self,
        file: FileId,
        pat: PatId,
    ) -> Option<TypeId> {
        self.implied_by_pattern(file, pat, IncludePatternInType::Yes, ReportErrors::No)
    }

    /// `getTypeFromBindingPattern(pat, includePatternInType, reportErrors)`. `None` for a plain name.
    pub(super) fn implied_by_pattern(
        &mut self,
        file: FileId,
        pat: PatId,
        for_context: IncludePatternInType,
        report_errors: ReportErrors,
    ) -> Option<TypeId> {
        if for_context == IncludePatternInType::No
            || matches!(
                self.hir(file)[pat].kind,
                PatKind::Missing | PatKind::Ident(_)
            )
        {
            return self.implied_by_pattern_inner(file, pat, for_context, report_errors);
        }
        if self.contextual_binding_patterns.is_empty() {
            self.taints_before_patterns = if self.is_innermost_tainted() {
                u64::MAX
            } else {
                self.taints
            };
        }
        self.contextual_binding_patterns
            .push((file, pat, self.stack.len()));
        let ty = self.implied_by_pattern_inner(file, pat, for_context, report_errors);
        self.contextual_binding_patterns.pop();
        ty
    }

    /// Whether `e` references a binding of a pattern whose implied type is in progress, from within
    /// that pattern.
    #[inline]
    pub(super) fn is_reference_within_contextual_pattern(
        &mut self,
        file: FileId,
        e: ExprId,
        sym: Sym,
    ) -> bool {
        !self.contextual_binding_patterns.is_empty()
            && sym.file == file
            && self.is_reference_within_one_of_the_patterns(file, e, sym)
    }

    fn is_reference_within_one_of_the_patterns(
        &mut self,
        file: FileId,
        e: ExprId,
        sym: Sym,
    ) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let Some(&(crate::bind::Decl::Var(declared) | crate::bind::Decl::Param(declared))) =
            bound.symbols[sym.id.idx()].decls.first()
        else {
            return false;
        };
        let (PatParent::Prop(pattern, _) | PatParent::Elem(pattern, _)) =
            bound.pat_parent[declared.idx()]
        else {
            return false;
        };
        let Some(&(_, _, floor)) = self
            .contextual_binding_patterns
            .iter()
            .find(|p| p.0 == file && p.1 == pattern)
        else {
            return false;
        };
        if hir
            .find_ancestor(hir.node(e), |n| n == hir.node(pattern))
            .is_none()
        {
            return false;
        }
        // Results derived from it are valid only while the implied type is in progress, except from
        // the innermost resolution down: tsgo stores `links.resolvedType` and
        // `signature.resolvedReturnType` whatever is in progress, and reports what it finds.
        let floor = floor.min(self.stack.len());
        let is_stored = |q: &Query| {
            matches!(
                q,
                Query::Pat(..)
                    | Query::ParameterSymbol(..)
                    | Query::Symbol(_)
                    | Query::Return(..)
                    | Query::ReturnAtFirstLook(..)
            )
        };
        let innermost = self.stack[floor..].iter().rposition(is_stored);
        self.mark_tainted_by_pattern_from(innermost.map_or(floor, |at| floor + at + 1));
        self.note_cycle();
        true
    }

    /// `getTypeFromBindingPattern`
    fn implied_by_pattern_inner(
        &mut self,
        file: FileId,
        pat: PatId,
        for_context: IncludePatternInType,
        report_errors: ReportErrors,
    ) -> Option<TypeId> {
        let hir = self.hir(file);
        match hir[pat].kind {
            PatKind::Missing | PatKind::Ident(_) => None,
            // `getTypeFromArrayBindingPattern`
            PatKind::Array(elems) => {
                let rest_element = elems.iter().next_back().filter(|&e| hir[e].is_rest);
                if elems.is_empty() || (elems.len() == 1 && rest_element.is_some()) {
                    if self.p.files.options.target == crate::resolve::ScriptTarget::ES5 {
                        return Some(self.array_of(TypeId::ANY));
                    }
                    // `createIterableType`, `getGlobalIterableTypeChecked`
                    return Some(self.global_ref_checked(
                        known::Iterable,
                        &[TypeId::ANY, TypeId::VOID, TypeId::UNDEFINED],
                    ));
                }
                let min_length = elems
                    .iter()
                    .rposition(|e| {
                        !(Some(e) == rest_element
                            || matches!(hir[hir[e].pat].kind, PatKind::Missing)
                            || hir[e].default.is_some())
                    })
                    .map_or(0, |last| last + 1);
                let mut types = Vec::with_capacity(elems.len());
                let mut flags = Vec::with_capacity(elems.len());
                for (i, e) in elems.iter().enumerate() {
                    let elem = &hir[e];
                    types.push(if matches!(hir[elem.pat].kind, PatKind::Missing) {
                        TypeId::ANY
                    } else {
                        self.type_from_binding_element(
                            file,
                            elem.pat,
                            elem.default,
                            for_context,
                            report_errors,
                        )
                    });
                    flags.push(if Some(e) == rest_element {
                        ElemFlags::REST
                    } else if i >= min_length {
                        ElemFlags::OPTIONAL
                    } else {
                        ElemFlags::REQUIRED
                    });
                }
                Some(self.tuple(&types, &flags, false))
            }
            // `getTypeFromObjectBindingPattern`
            PatKind::Object(props) => {
                let mut shape = Shape::new_in(self.arena);
                let mut has_computed_names = false;
                for p in props.iter() {
                    let prop = &hir[p];
                    if prop.is_rest {
                        shape
                            .index
                            .push(IndexInfo::new(TypeId::STRING, TypeId::ANY, false));
                        continue;
                    }
                    // A name that is only known at run time is omitted, and so is a private name:
                    // its `getLiteralTypeFromPropertyName` is `never`.
                    let name = match prop.key {
                        PropKey::Private(_) => None,
                        key => self.member_name(file, key),
                    };
                    let Some(name) = name else {
                        has_computed_names = true;
                        continue;
                    };
                    let ty = self.type_from_binding_element(
                        file,
                        prop.value,
                        prop.default,
                        for_context,
                        report_errors,
                    );
                    let flags = if prop.default.is_some() {
                        PropFlags::OPTIONAL
                    } else {
                        PropFlags::empty()
                    };
                    // The last of two with the same name wins.
                    let implied = Prop {
                        name,
                        flags,
                        source: PropSource::Type(ty),
                        mapper: MapperId::IDENTITY,
                    };
                    match shape.props.iter_mut().find(|p| p.name == name) {
                        Some(earlier) => *earlier = implied,
                        None => shape.props.push(implied),
                    }
                }
                // `getNamedMembers`: members without a declaration are ordered by name.
                let atoms = &self.atoms();
                shape
                    .props
                    .sort_by(|a, b| atoms.bytes(a.name).cmp(atoms.bytes(b.name)));
                // `patternForType`
                if for_context == IncludePatternInType::Yes {
                    shape.literal = if has_computed_names {
                        Literalness::PatternWithComputedNames
                    } else {
                        Literalness::Pattern
                    };
                } else {
                    // `ObjectFlagsObjectLiteral`, not fresh.
                    (shape.literal, shape.is_regular) = (Literalness::Literal, true);
                }
                shape.has_no_instantiable_symbol = true;
                Some(self.synth(shape))
            }
        }
    }

    /// `getTypeFromBindingElement` for the element of a pattern that binds `pat` and has the
    /// initializer `default`.
    pub(super) fn type_from_binding_element(
        &mut self,
        file: FileId,
        pat: PatId,
        default: ExprId,
        for_context: IncludePatternInType,
        report_errors: ReportErrors,
    ) -> TypeId {
        if default.is_some() {
            let contextual_type = self
                .context_implied_by_pattern(file, pat)
                .unwrap_or(TypeId::UNKNOWN);
            let ty = self.check_expression_with_contextual_type(
                file,
                default,
                contextual_type,
                None,
                CheckMode::empty(),
            );
            // `checkDeclarationInitializer`: under a parameter, the type of a default is padded
            // with the members its own pattern has defaults for.
            let ty = match root_declaration(self.bound(file), pat) {
                PatParent::Param(root) => {
                    self.note_checked_with_contextual_type(file, root, default);
                    self.padded_for_pattern(file, pat, ty)
                }
                _ => ty,
            };
            let ty = self.get_widened_literal_type_for_initializer(file, pat, ty);
            return self.optional(ty);
        }
        if let Some(implied) = self.implied_by_pattern(file, pat, for_context, report_errors) {
            return implied;
        }
        if report_errors == ReportErrors::Yes
            && !self.declaration_belongs_to_private_ambient_member(file, pat)
        {
            self.report_implicit_any_of_name(file, pat, TypeId::ANY);
        }
        if for_context == IncludePatternInType::Yes {
            TypeId::NON_INFERRABLE_ANY
        } else {
            TypeId::ANY
        }
    }

    /// `patternForType`, as `checkObjectLiteral` queries it: whether `ty` was created from an
    /// object pattern as the contextual type of its initializer, or is the type of an object
    /// literal that is an assignment target. `Some(true)`: from one with names that are only known
    /// at run time (`ObjectFlagsObjectLiteralPatternWithComputedProperties`).
    pub(super) fn pattern_of_type(&mut self, ty: TypeId) -> Option<bool> {
        match *self.data(ty) {
            TypeData::Synth(ref shape) => match shape.literal {
                Literalness::Pattern => Some(false),
                Literalness::PatternWithComputedNames => Some(true),
                _ => None,
            },
            TypeData::Anon {
                origin: Origin::ObjectLiteral(file, e, ..),
                ..
            } if self.is_definite_assignment_target(file, e) => {
                let hir = self.hir(file);
                let ExprKind::Object(props) = hir[e].kind else {
                    return None;
                };
                let keys = self.union(&[TypeId::STRING, TypeId::NUMBER, TypeId::SYMBOL]);
                let mut has_computed_names = false;
                for p in props.iter() {
                    if let PropKey::Computed(k) = hir[p].key
                        && self.member_name(file, hir[p].key).is_none()
                    {
                        let key = self.type_of_expr(file, k);
                        has_computed_names |= self.is_assignable(key, keys);
                    }
                }
                Some(has_computed_names)
            }
            _ => None,
        }
    }

    /// Whether `ty` is such a type, or a tuple or a union that contains one.
    fn has_pattern_mark(&self, ty: TypeId) -> bool {
        match self.data(ty) {
            TypeData::Synth(shape) => matches!(
                shape.literal,
                Literalness::Pattern | Literalness::PatternWithComputedNames
            ),
            TypeData::Anon {
                origin: Origin::ObjectLiteral(file, e, ..),
                ..
            } => self.is_definite_assignment_target(*file, *e),
            // A type from a type node has no mark.
            TypeData::Tuple {
                elems: TypeArguments::Given(parts),
                ..
            }
            | TypeData::Union(parts) => parts.iter().any(|&p| self.has_pattern_mark(p)),
            _ => false,
        }
    }

    /// `getCovariantInference` ends in `getWidenedType`: an inference from the implied type of a
    /// pattern is an ordinary type, which is not in `patternForType`.
    fn without_pattern_marks(&mut self, ty: TypeId) -> TypeId {
        if self.has_pattern_mark(ty) {
            self.get_widened_type(ty)
        } else {
            ty
        }
    }

    /// `patternForType[t] != nil` for `t`, the contextual type of `e`.
    fn is_expected_by_pattern(
        &mut self,
        file: FileId,
        e: ExprId,
        t: TypeId,
        context_flags: ContextFlags,
    ) -> bool {
        if self.pattern_of_type(t).is_some() {
            return true;
        }
        // A tuple carries no mark. It was created from an array pattern if it differs from the
        // contextual type computed with binding patterns skipped.
        if !self.is_tuple(t) || context_flags.contains(ContextFlags::SKIP_BINDING_PATTERNS) {
            return false;
        }
        let regardless =
            self.contextual_type(file, e, context_flags | ContextFlags::SKIP_BINDING_PATTERNS);
        regardless != Some(t)
    }

    fn type_implied_by_pattern_with_elements(
        &mut self,
        file: FileId,
        pat: PatId,
    ) -> Option<TypeId> {
        match self.hir(file)[pat].kind {
            PatKind::Array(elems) if elems.is_empty() => None,
            PatKind::Object(props) if props.is_empty() => None,
            _ => self.context_implied_by_pattern(file, pat),
        }
    }

    /// `pushCachedContextualType`
    pub(super) fn push_cached_contextual_type(&mut self, file: FileId, node: ExprId) {
        let t = self.contextual_type(file, node, ContextFlags::empty());
        self.push_contextual_type(file, node, t, true);
    }

    /// `pushContextualType`
    #[inline]
    pub(super) fn push_contextual_type(
        &mut self,
        file: FileId,
        node: ExprId,
        t: Option<TypeId>,
        is_cache: bool,
    ) {
        self.contextual.push(ContextualInfo {
            file,
            node,
            t,
            is_cache,
        });
    }

    /// `popContextualType`
    #[inline]
    pub(super) fn pop_contextual_type(&mut self) {
        self.contextual.pop();
    }

    /// `findContextualNode`. A node that is checked again while it is being checked has several
    /// entries: the search begins at the one that was pushed first.
    pub(super) fn find_contextual_node(
        &self,
        file: FileId,
        node: ExprId,
        include_caches: bool,
    ) -> Option<ContextualInfo> {
        let mut infos = self.contextual.iter();
        infos
            .find(|info| {
                info.file == file && info.node == node && (include_caches || !info.is_cache)
            })
            .copied()
    }

    /// `getContextualType`
    pub(super) fn contextual_type(
        &mut self,
        file: FileId,
        e: ExprId,
        context_flags: ContextFlags,
    ) -> Option<TypeId> {
        let hir = self.hir(file);
        // `getContextualType`: a node inside a `with` statement has no contextual type.
        if hir.is_in_with(hir[e].pos) {
            return None;
        }
        // "Cached contextual types are obtained with no ContextFlags, so we can only consult them
        // for requests with no ContextFlags."
        if let Some(info) = self.find_contextual_node(file, e, context_flags.is_empty()) {
            return info.t;
        }
        let ty = self.contextual_type_from_parent(file, e, context_flags)?;
        if ty == TypeId::UNRESOLVED {
            return None;
        }
        // The contextual type of a call is only used for inference. A call of an immediately
        // invoked function passes it on to the function's `return`s.
        if let ExprKind::Call(c) | ExprKind::New(c) | ExprKind::TaggedTemplate(c) = hir[e].kind
            && !matches!(hir[hir[c].callee].kind, ExprKind::Fn(_))
        {
            return Some(self.without_pattern_marks(ty));
        }
        Some(ty)
    }

    fn contextual_type_from_parent(
        &mut self,
        file: FileId,
        e: ExprId,
        context_flags: ContextFlags,
    ) -> Option<TypeId> {
        let hir = self.hir(file);
        let bound = self.bound(file);
        // `getContextualType` has no case for a TypeQuery or QualifiedName parent. The binder parents the operand of a `typeof` type
        // to the enclosing function or property only so that `this` resolves.
        if bound.is_in_type_query(e) {
            return None;
        }
        match bound.expr_parent[e.idx()] {
            Parent::VarInit(d) => {
                let decl = &hir[d];
                if decl.ty.is_some() {
                    return Some(self.type_from_node(file, decl.ty));
                }
                if context_flags.contains(ContextFlags::SKIP_BINDING_PATTERNS) {
                    return None;
                }
                self.type_implied_by_pattern_with_elements(file, decl.pat)
            }
            Parent::ParamDefault(p) => {
                if hir[p].ty.is_some() {
                    return Some(self.type_from_node(file, hir[p].ty));
                }
                let func = bound.param_fn[p.idx()];
                match self.contextual_param_type(
                    file,
                    func,
                    (p.0 - hir[func].params.start) as usize,
                ) {
                    Some(ty) => Some(ty),
                    None if context_flags.contains(ContextFlags::SKIP_BINDING_PATTERNS) => None,
                    None => self.type_implied_by_pattern_with_elements(file, hir[p].pat),
                }
            }
            Parent::MemberInit(m) => {
                if hir[m].ty.is_some() {
                    return Some(self.type_from_node(file, hir[m].ty));
                }
                // `getContextualTypeForStaticPropertyDeclaration`
                if hir[m].flags.contains(Flags::STATIC)
                    && let crate::bind::MemberOwner::Class(c) = bound.member_owner[m.idx()]
                    && let crate::bind::ClassOwner::Expr(class) = bound.class_owner[c.idx()]
                {
                    let expected = self.contextual_type(file, class, context_flags)?;
                    let name = self.declared_member_name(file, hir[m].key)?;
                    return self.contextual_property(expected, name);
                }
                None
            }
            Parent::FnBody(f) => self.contextual_return_type(file, f, context_flags),
            Parent::Stmt(s) => match hir[s].kind {
                StmtKind::Return(_) => {
                    let f = self.enclosing_fn(file, Parent::Stmt(s))?;
                    self.contextual_return_type(file, f, context_flags)
                }
                // `tryGetTypeFromTypeNode(parent)`
                StmtKind::ExportDefault(_) | StmtKind::ExportAssign(_) => {
                    let annotation = hir.jsdoc_type(JsDocTypeOwner::Export(s));
                    annotation
                        .is_some()
                        .then(|| self.type_from_node(file, annotation))
                }
                _ => None,
            },
            Parent::Prop(p) => {
                // `getContextualTypeForObjectLiteralElement`: `element.Type()`
                let annotation = hir.jsdoc_type(JsDocTypeOwner::Prop(p));
                if annotation.is_some() {
                    return Some(self.type_from_node(file, annotation));
                }
                let owner = bound.prop_owner[p.idx()];
                let prop = &hir[p];
                if let ExprKind::Jsx(_) = hir[owner].kind {
                    if prop.kind == PropKind::Spread {
                        return self.contextual_jsx_element_attributes_type(file, owner);
                    }
                    let props = self.apparent_type_of_contextual_type_of_jsx_attributes(
                        file,
                        owner,
                        context_flags,
                    )?;
                    let name = self.member_name(file, prop.key)?;
                    return self.contextual_property_of_value(file, e, props, name, None);
                }
                // The contextual type of a spread expression is that of the literal, unmodified: a
                // type parameter stays a type parameter.
                if prop.kind == PropKind::Spread {
                    return self.contextual_type(file, owner, context_flags);
                }
                let context = self.apparent_type_of_contextual_type(file, owner, context_flags)?;
                let name_expression = match prop.key {
                    PropKey::Computed(k) if is_dynamic_name(hir, k) => k,
                    // `symbol.Name`, as the binder has it. A missing name is the empty string.
                    key => {
                        return match self.declared_member_name(file, key) {
                            Some(name) => {
                                self.contextual_property_of_value(file, e, context, name, None)
                            }
                            None => self.contextual_index(context, TypeId::STRING),
                        };
                    }
                };
                let expr_type = self.type_of_expr(file, name_expression);
                let name_type = self.regular(expr_type);
                if let Some(name) = self.member_name(file, prop.key) {
                    // `hasLateBindableName`: `[zero]` is a number.
                    if is_entity_name_expression(hir, name_expression) {
                        let name_type = Some(name_type);
                        return self
                            .contextual_property_of_value(file, e, context, name, name_type);
                    }
                    let found = self.contextual_property_of_value(file, e, context, name, None);
                    if found.is_some() {
                        return found;
                    }
                }
                // `getLiteralTypeFromPropertyName`
                self.contextual_index(
                    context,
                    if name_type == TypeId::UNRESOLVED {
                        TypeId::STRING
                    } else {
                        name_type
                    },
                )
            }
            Parent::Expr(parent) => self.contextual_type_in_expr(file, e, parent, context_flags),
            // `getContextualTypeForDecorator`
            Parent::Decorator(_, owner) => {
                let sig = self.decorator_call_signature(file, owner)?;
                Some(self.type_of_signature(sig, false))
            }
            Parent::PatPropDefault(p) => {
                self.contextual_type_for_default_of_element(file, hir[p].value, context_flags)
            }
            Parent::PatElemDefault(p) => {
                self.contextual_type_for_default_of_element(file, hir[p].pat, context_flags)
            }
            _ => None,
        }
    }

    /// `getContextualTypeForInitializerExpression` for the default of `pat`, an element of a
    /// pattern.
    fn contextual_type_for_default_of_element(
        &mut self,
        file: FileId,
        pat: PatId,
        context_flags: ContextFlags,
    ) -> Option<TypeId> {
        match self.contextual_type_for_binding_element(file, pat) {
            Some(ty) => Some(ty),
            None if context_flags.contains(ContextFlags::SKIP_BINDING_PATTERNS) => None,
            None => self.type_implied_by_pattern_with_elements(file, pat),
        }
    }

    /// `getContextualTypeForBindingElement`: the type of the value that the default of `pat`, an
    /// element of a pattern, replaces.
    fn contextual_type_for_binding_element(&mut self, file: FileId, pat: PatId) -> Option<TypeId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (parent, place) = match bound.pat_parent[pat.idx()] {
            PatParent::Prop(parent, prop) if !hir[prop].is_rest => {
                // `IsComputedNonLiteralName`: a name that has to be evaluated is not looked up.
                if let PropKey::Computed(k) = hir[prop].key
                    && !is_string_or_numeric_literal_like(hir, k)
                {
                    return None;
                }
                (parent, Ok(hir[prop].key))
            }
            PatParent::Elem(parent, elem) if !hir[elem].is_rest => {
                let PatKind::Array(elems) = hir[parent].kind else {
                    return None;
                };
                // A pattern in place of a name provides its own implied type.
                if !matches!(hir[pat].kind, PatKind::Ident(_)) {
                    return None;
                }
                (parent, Err((elem.0 - elems.start) as usize))
            }
            _ => return None,
        };
        let parent_ty = match bound.pat_parent[parent.idx()] {
            PatParent::Var(d) if hir[d].ty.is_some() => self.type_from_node(file, hir[d].ty),
            PatParent::Var(d) if hir[d].init.is_some() => {
                self.check_declaration_initializer(file, parent, hir[d].init, false)?
            }
            PatParent::Param(p) if hir[p].ty.is_some() => self.type_from_node(file, hir[p].ty),
            PatParent::Param(p) => {
                let func = bound.param_fn[p.idx()];
                match self.contextual_param_type(
                    file,
                    func,
                    (p.0 - hir[func].params.start) as usize,
                ) {
                    Some(ty) => ty,
                    None if hir[p].default.is_some() => {
                        self.check_declaration_initializer(file, parent, hir[p].default, true)?
                    }
                    None => return None,
                }
            }
            PatParent::Prop(..) | PatParent::Elem(..) => {
                self.contextual_type_for_binding_element(file, parent)?
            }
            _ => return None,
        };
        match place {
            Ok(key) => {
                let name = self.member_name(file, key)?;
                self.type_of_property_of_type(parent_ty, name)
            }
            Err(index) => self.contextual_element_at(parent_ty, index, None, None, None),
        }
    }

    /// `checkDeclarationInitializer(parent, CheckModeNormal, nil)` for `getContextualTypeForBindingElement`: `parent` is the
    /// variable, or the parameter if `is_parameter`, whose name is the pattern `name`. `None`: see `check_initializer_cached`.
    fn check_declaration_initializer(
        &mut self,
        file: FileId,
        name: PatId,
        initializer: ExprId,
        is_parameter: bool,
    ) -> Option<TypeId> {
        let ty = self.check_initializer_cached(file, initializer)?;
        Some(if is_parameter {
            self.padded_for_pattern(file, name, ty)
        } else {
            ty
        })
    }

    /// `getQuickTypeOfExpression`, then `checkExpressionCached`. That has no re-entrancy guard: an initializer that is being
    /// checked is checked again, until one of the visits returns and assigns `links.resolvedType`.
    ///
    /// A function whose first check (`NodeCheckFlagsContextChecked`) leads here begins a visit, which skips that function and
    /// gets to the next one: as many visits are nested as there are such functions. tsgo has a stack that grows. In the upper
    /// half of this one a nested visit gets no further visit but `None`, and what has asked is not stored: it asks again from
    /// a lower height, after `links.resolvedType` is assigned.
    fn check_initializer_cached(&mut self, file: FileId, initializer: ExprId) -> Option<TypeId> {
        let q = Query::Expr(file, initializer);
        let from = self.resolution_start.min(self.stack.len());
        let outermost = match self.may_be_in_flight(q) {
            true => self.stack[from..].iter().position(|&visit| visit == q),
            false => None,
        };
        let Some(outermost) = outermost.map(|above| from + above) else {
            let outer = self.suspend_recheck();
            let ty = self.type_of_declaration_initializer(file, initializer);
            self.end_recheck(outer);
            return Some(ty);
        };
        // `type_of_declaration_initializer` would enter the expression again.
        if let Some(quick) = self.quick_type_of_expr(file, initializer) {
            return Some(quick);
        }
        let serial = self.frames[outermost].serial;
        let frames = &self.frames;
        self.initializers_resolved_by_nested_visit
            .retain(|it| frames.get(it.0).is_some_and(|frame| frame.serial == it.1));
        let mut resolved = self.initializers_resolved_by_nested_visit.iter();
        if let Some(&(.., ty)) = resolved.find(|it| it.1 == serial) {
            return Some(ty);
        }
        let innermost = self.stack.iter().rposition(|&visit| visit == q);
        if let Some(innermost) = innermost.filter(|&innermost| innermost != outermost)
            && (self.stack.len() >= MAX_DEPTH / 2 || self.is_half_of_stack_in_use())
        {
            // The frames of a visit store nothing, up to the first that is not rechecked.
            let is_stored = |in_flight: &Query| match *in_flight {
                Query::LiteralProp(..) => false,
                Query::Expr(of, e) => matches!(
                    self.hir(of)[e].kind,
                    ExprKind::Ident(_)
                        | ExprKind::This
                        | ExprKind::Dot { .. }
                        | ExprKind::Index { .. }
                ),
                _ => true,
            };
            let stored = self.stack[innermost + 1..].iter().position(is_stored);
            let top = (self.stack.len() - 1).max(innermost + 1);
            self.bailed_out_from(stored.map_or(top, |above| innermost + 1 + above));
            return None;
        }
        // Results computed under what is pushed are not valid here, nor these there.
        let found_outside = (
            std::mem::take(&mut self.rechecked_exprs),
            std::mem::take(&mut self.rechecked_members),
        );
        let outer = self.begin_recheck();
        let ty = self.check_expression_ex(file, initializer, CheckMode::empty());
        self.end_recheck(outer);
        (self.rechecked_exprs, self.rechecked_members) = found_outside;
        // Of two nested visits the outer one assigns last. A visit that was refused assigns nothing.
        if ty != TypeId::UNRESOLVED {
            match self
                .initializers_resolved_by_nested_visit
                .iter_mut()
                .find(|it| it.1 == serial)
            {
                Some(it) => it.2 = ty,
                None => self
                    .initializers_resolved_by_nested_visit
                    .push((outermost, serial, ty)),
            }
        }
        Some(ty)
    }

    /// `contextual_property`, for the value `e` of the property. A literal or a function is queried
    /// again for everything nested in it, so its result is cached where it is final.
    fn contextual_property_of_value(
        &mut self,
        file: FileId,
        e: ExprId,
        context: TypeId,
        name: Atom,
        name_type: Option<TypeId>,
    ) -> Option<TypeId> {
        if !matches!(
            self.hir(file)[e].kind,
            ExprKind::Object(_) | ExprKind::Array(_) | ExprKind::Fn(_)
        ) || !self.contextual_binding_patterns.is_empty()
        {
            return self.contextual_property_ex(context, name, name_type);
        }
        let key = (context, name, name_type);
        if let Some(&found) = self.contextual_properties.get(&key) {
            return found;
        }
        let before = self.non_cacheable_mark();
        let found = self.contextual_property_ex(context, name, name_type);
        if self.is_cacheable_since(before) {
            self.contextual_properties.insert(key, found);
        }
        found
    }

    /// `getTypeOfPropertyOfContextualType`
    pub(super) fn contextual_property(&mut self, context: TypeId, name: Atom) -> Option<TypeId> {
        self.contextual_property_ex(context, name, None)
    }

    /// `getTypeOfPropertyOfContextualTypeEx`: the type of the property `name` in each member of
    /// `context`. `name_type`: what an index signature is looked for with, if not the name.
    fn contextual_property_ex(
        &mut self,
        context: TypeId,
        name: Atom,
        name_type: Option<TypeId>,
    ) -> Option<TypeId> {
        // `mapTypeEx`
        if context.is_never() {
            return Some(context);
        }
        let mut types = Parts::new();
        for &part in self.parts(context) {
            let found = if self.is_intersection(part) {
                self.contextual_property_of_intersection(part, name, name_type)
            } else if !self.is_object_type(part) {
                None
            } else if self.is_generic_mapped_without_remapping(part) {
                self.contextual_property_of_generic_mapped(part, name, name_type)
            } else {
                match self.concrete_contextual_property(part, name) {
                    Some(declared) => Some(declared),
                    None => self.contextual_type_from_index_infos(part, name, name_type),
                }
            };
            types.extend(found);
        }
        if types.is_empty() {
            None
        } else {
            Some(self.union_unreduced(&types))
        }
    }

    /// The same for the intersection `whole`: the declared properties of its members and, only if
    /// none declares it, their index signatures.
    fn contextual_property_of_intersection(
        &mut self,
        whole: TypeId,
        name: Atom,
        name_type: Option<TypeId>,
    ) -> Option<TypeId> {
        let TypeData::Intersection(members) = self.data(whole) else {
            return None;
        };
        // `appendContextualPropertyTypeConstituent`: `any` carries no information, and must not
        // absorb the other constituents.
        let reported = |c: &Self, t: TypeId| {
            if c.has_any_flag(t) {
                TypeId::UNKNOWN
            } else {
                t
            }
        };
        let (mut found, mut candidates) = (Parts::new(), Parts::new());
        let mut ignore_index_infos = false;
        for &m in members.iter() {
            if !self.is_object_type(m) {
                continue;
            }
            // A generic mapped type contributes no index signatures.
            if self.is_generic_mapped_without_remapping(m) {
                let property = self.contextual_property_of_generic_mapped(m, name, name_type);
                found.extend(property.map(|t| reported(self, t)));
                continue;
            }
            match self.concrete_contextual_property(m, name) {
                Some(declared) => {
                    ignore_index_infos = true;
                    candidates.clear();
                    found.push(reported(self, declared));
                }
                None if !ignore_index_infos => candidates.push(m),
                None => {}
            }
        }
        for m in candidates {
            let indexed = self.contextual_type_from_index_infos(m, name, name_type);
            found.extend(indexed.map(|t| reported(self, t)));
        }
        match found[..] {
            [] => None,
            [only] => Some(only),
            _ => Some(self.intersection(&found)),
        }
    }

    /// `isGenericMappedType(t) && getMappedTypeNameTypeKind(t) != MappedTypeNameTypeKindRemapping`
    fn is_generic_mapped_without_remapping(&mut self, t: TypeId) -> bool {
        if self.mapped_origin(t).is_none() || !self.is_generic(t) {
            return false;
        }
        match self.mapped_name_type(t) {
            // An `as` clause that yields the key or `never` only filters keys.
            Some(renamed) => {
                let key = self.mapped_type_param(t);
                self.is_assignable(renamed, key)
            }
            None => true,
        }
    }

    /// `getIndexedMappedTypeSubstitutedTypeOfContextualType`: the property type a generic mapped
    /// type produces for the key `name`.
    fn contextual_property_of_generic_mapped(
        &mut self,
        t: TypeId,
        name: Atom,
        name_type: Option<TypeId>,
    ) -> Option<TypeId> {
        let key = match name_type {
            Some(key) => key,
            // A symbol name represents that symbol.
            None if self.atoms().is_symbol_name(name) => self.key_type_of_name(name)?,
            None => self.string_literal(name, false),
        };
        let keys = self.mapped_keys(t);
        if let Some(renamed) = self.mapped_name_type(t)
            && self.is_excluded_mapped_property_name(renamed, key)
        {
            return None;
        }
        if self.is_excluded_mapped_property_name(keys, key) {
            return None;
        }
        // `getBaseConstraintOrType`
        let widest = self.base_constraint_of(keys).unwrap_or(keys);
        if !self.is_assignable(key, widest) {
            return None;
        }
        // `undefined` is preserved where the mapped type makes properties optional.
        self.substitute_indexed_generic_mapped(t, key)
    }

    /// `isExcludedMappedPropertyName`: `K extends X ? never : K` means "not an `X`".
    fn is_excluded_mapped_property_name(&mut self, t: TypeId, key: TypeId) -> bool {
        match self.data(t) {
            TypeData::Cond { .. } => {
                let (check, yes, no) = (
                    self.cond_piece(t, 0),
                    self.cond_piece(t, 2),
                    self.cond_piece(t, 3),
                );
                if !self.reduced(yes).is_never()
                    || self.actual_type_variable(no) != self.actual_type_variable(check)
                {
                    return false;
                }
                let extends = self.cond_piece(t, 1);
                self.is_assignable(key, extends)
            }
            TypeData::Intersection(parts) => parts
                .iter()
                .any(|&p| self.is_excluded_mapped_property_name(p, key)),
            _ => false,
        }
    }

    /// `getTypeOfConcretePropertyOfContextualType`
    fn concrete_contextual_property(&mut self, part: TypeId, name: Atom) -> Option<TypeId> {
        let members = self.members(part)?;
        let (prop, mapper) = self.property_in_type(part, &members, name)?;
        // `isCircularMappedProperty`
        if let PropSource::Mapped(of, ..) = prop.source
            && let containing_type = self.containing_type_of_mapped_prop(of, prop)
            && self.is_resolving(Query::MappedProp(containing_type, prop.name))
        {
            return None;
        }
        let ty = self.type_of_prop(prop, mapper);
        Some(self.remove_missing_type(ty, prop.flags.contains(PropFlags::OPTIONAL)))
    }

    /// `getTypeFromIndexInfosOfContextualType`
    fn contextual_type_from_index_infos(
        &mut self,
        part: TypeId,
        name: Atom,
        name_type: Option<TypeId>,
    ) -> Option<TypeId> {
        // An index past the fixed prefix of a tuple falls in the part covered by its rest element.
        if let TypeData::Tuple { flags, .. } = self.data(part)
            && self.is_numeric_name(name)
            && crate::atom::parse_number(self.atoms().bytes(name)).is_some_and(|n| n >= 0.0)
        {
            let elems = self.type_arguments(part);
            let fixed = Self::fixed_length(flags);
            if let Some(rest) = self.element_type_of_slice(elems, flags, fixed, 0, true) {
                return Some(rest);
            }
        }
        let members = self.members(part)?;
        let info = match name_type {
            Some(key) => self.applicable_index_info(&members, key),
            // A symbol name uses the index signature for symbols.
            None if self.atoms().is_symbol_name(name) => {
                self.applicable_index_info(&members, TypeId::SYMBOL)
            }
            None => self.applicable_index_info_for_name(&members, name),
        };
        Some(info?.value)
    }

    /// `getApplicableIndexInfo`, member by member, for a name of which only the type `key` is known.
    fn contextual_index(&mut self, context: TypeId, key: TypeId) -> Option<TypeId> {
        // `mapTypeEx`
        if context.is_never() {
            return Some(context);
        }
        let mut types = Vec::new();
        for &part in self.parts(context) {
            if let Some(members) = self.members(part)
                && let Some(info) = self.applicable_index_info(&members, key)
            {
                types.push(info.value);
            }
        }
        (!types.is_empty()).then(|| self.union_unreduced(&types))
    }

    /// `getApparentTypeOfContextualType`
    pub(super) fn apparent_type_of_contextual_type(
        &mut self,
        file: FileId,
        e: ExprId,
        context_flags: ContextFlags,
    ) -> Option<TypeId> {
        let contextual_type = self.contextual_type(file, e, context_flags)?;
        let apparent = self.apparent_contextual_type(contextual_type, file, e, context_flags)?;
        if matches!(self.hir(file)[e].kind, ExprKind::Object(_)) {
            return Some(self.discriminate_by_object_members(file, e, apparent));
        }
        Some(apparent)
    }

    /// The same for the attributes of the JSX element `e`, which are not a separate node.
    pub(super) fn apparent_type_of_contextual_type_of_jsx_attributes(
        &mut self,
        file: FileId,
        e: ExprId,
        context_flags: ContextFlags,
    ) -> Option<TypeId> {
        let contextual_type = self.contextual_jsx_element_attributes_type(file, e)?;
        let apparent = self.apparent_contextual_type(contextual_type, file, e, context_flags)?;
        Some(self.discriminate_by_jsx_attributes(file, e, apparent))
    }

    /// `getApparentTypeOfContextualType`, between `getContextualType` and the discrimination.
    fn apparent_contextual_type(
        &mut self,
        contextual_type: TypeId,
        file: FileId,
        e: ExprId,
        context_flags: ContextFlags,
    ) -> Option<TypeId> {
        let instantiated =
            self.instantiate_contextual_type(contextual_type, file, e, context_flags);
        if context_flags.contains(ContextFlags::NO_CONSTRAINTS)
            && self.is_type_variable(instantiated)
        {
            return None;
        }
        // A type parameter is not cloned with the signature it belongs to: the outer type arguments
        // of the signature are not applied to its constraint.
        let sig = if self.maybe_type_of_kind(instantiated, Self::is_deferred) {
            self.get_inference_context(file, e)
                .and_then(|level| self.inference_contexts[level].context.as_ref()?.sig)
        } else {
            None
        };
        let around = match sig {
            Some(sig) => self.mapper_around_sig(sig),
            None => MapperId::IDENTITY,
        };
        Some(self.map_type_unreduced(instantiated, |c, t| {
            if c.mapped_origin(t).is_some() {
                return t;
            }
            // `getApparentType`
            let constraint = if c.is_deferred(t) {
                let constraint = c.base_constraint(t);
                c.filled_in_around(t, constraint, around)
            } else {
                t
            };
            if c.is_intersection(constraint) {
                c.apparent_type_of_intersection_type(constraint, t)
            } else if constraint == t {
                c.apparent_type(t)
            } else {
                let constraint = c.type_with_this_argument(constraint, t);
                c.apparent_type(constraint)
            }
        }))
    }

    /// `getApparentTypeOfIntersectionType`. `apparent_type` leaves it out where the members of the
    /// intersection as a whole do not depend on it.
    pub(super) fn apparent_type_of_intersection_type(
        &mut self,
        t: TypeId,
        this_argument: TypeId,
    ) -> TypeId {
        let key = (t, this_argument);
        if let Some(&cached) = self.apparent_types_of_intersections.get(&key) {
            return cached;
        }
        let before = self.non_cacheable_mark();
        let result = self.type_with_this_argument_ex(t, this_argument, true);
        if before == self.non_cacheable_mark() {
            self.apparent_types_of_intersections.insert(key, result);
        }
        result
    }

    /// `instantiateContextualType`
    pub(super) fn instantiate_contextual_type(
        &mut self,
        contextual_type: TypeId,
        file: FileId,
        e: ExprId,
        context_flags: ContextFlags,
    ) -> TypeId {
        if self.inference_contexts.is_empty()
            || !self.maybe_type_of_kind(contextual_type, Self::is_instantiable)
        {
            return contextual_type;
        }
        let has_content = |c: &Self, ty: TypeId| !c.is_any(ty) && ty != TypeId::UNKNOWN;
        self.get_inference_context(file, e)
            .and_then(|level| {
                self.with_inference_context(level, |c, n| {
                    if context_flags.contains(ContextFlags::SIGNATURE)
                        && c.has_inference_candidates_or_default(n)
                    {
                        let mut mapper_for = |c: &mut Self, t| c.non_fixing_mapper(n, t);
                        let ty = c.instantiate_instantiable_types(contextual_type, &mut mapper_for);
                        if has_content(c, ty) {
                            return ty;
                        }
                    }
                    let ty = c.with_return_context(level, |c, returned| {
                        let mut mapper_for = |c: &mut Self, t| c.fixing_mapper(returned, t);
                        c.instantiate_instantiable_types(contextual_type, &mut mapper_for)
                    });
                    match ty {
                        Some(ty) if has_content(c, ty) => c.without_boolean(ty),
                        _ => contextual_type,
                    }
                })
            })
            .unwrap_or(contextual_type)
    }

    /// `instantiateContextualType(getContextualType(e, ContextFlagsNone), e, ContextFlagsNone)`
    pub(super) fn instantiated_contextual_type(
        &mut self,
        file: FileId,
        e: ExprId,
    ) -> Option<TypeId> {
        let contextual_type = self.contextual_type(file, e, ContextFlags::empty())?;
        Some(self.instantiate_contextual_type(contextual_type, file, e, ContextFlags::empty()))
    }

    /// Takes the context at `level` out of `inference_contexts` while `f` runs. The placeholder
    /// left in its slot has its `returnMapper` and no type parameters: see `with_return_context`.
    /// `None`: `pushInferenceContext(node, nil)`.
    pub(super) fn with_inference_context<R>(
        &mut self,
        level: usize,
        f: impl FnOnce(&mut Self, &mut Inference) -> R,
    ) -> Option<R> {
        let mut context = self.take_inference_context(level)?;
        let result = f(self, &mut context);
        self.put_back_inference_context(level, context);
        Some(result)
    }

    fn take_inference_context(&mut self, level: usize) -> Option<Inference> {
        let context = self.inference_contexts[level].context.as_mut()?;
        let mut placeholder = Inference::for_params(&[], None);
        placeholder.return_context = context.return_context.take();
        Some(std::mem::replace(context, placeholder))
    }

    fn put_back_inference_context(&mut self, level: usize, mut context: Inference) {
        let slot = &mut self.inference_contexts[level].context;
        context.return_context = (slot.as_mut()).and_then(|it| it.return_context.take());
        *slot = Some(context);
    }

    /// Takes the context of `returnMapper` out of the slot at `level` of `inference_contexts` while
    /// `f` runs. `None`: `returnMapper` is nil, or it is mapping something.
    pub(super) fn with_return_context<R>(
        &mut self,
        level: usize,
        f: impl FnOnce(&mut Self, &mut Inference) -> R,
    ) -> Option<R> {
        let mut returned = self.take_return_context(level)?;
        let result = f(self, &mut returned);
        self.put_back_return_context(level, returned);
        Some(result)
    }

    fn take_return_context(&mut self, level: usize) -> Option<Box<Inference>> {
        let context = self.inference_contexts[level].context.as_mut()?;
        context.return_context.take()
    }

    fn put_back_return_context(&mut self, level: usize, returned: Box<Inference>) {
        if let Some(context) = &mut self.inference_contexts[level].context {
            context.return_context = Some(returned);
        }
    }

    /// `discriminateContextualTypeByObjectMembers`: narrows the union `context` to the members the object literal `literal` can
    /// match. Returns `context` unchanged if it is not a union.
    pub(super) fn discriminate_by_object_members(
        &mut self,
        file: FileId,
        literal: ExprId,
        context: TypeId,
    ) -> TypeId {
        let ExprKind::Object(props) = self.hir(file)[literal].kind else {
            return context;
        };
        if !self.is_union(context) {
            return context;
        }
        // While the implied type of a pattern is in progress, its names do not have the types any
        // other caller sees.
        if !self.contextual_binding_patterns.is_empty() {
            return self.discriminate_by_members(file, props, context).0;
        }
        // It is requested for every member of the literal, and again for everything nested in them.
        if let Some(&narrowed) = self.discriminated.get(&(file, literal, context)) {
            return narrowed;
        }
        let before = self.non_cacheable_mark();
        let (narrowed, is_given_for_good) = self.discriminate_by_members(file, props, context);
        if is_given_for_good && self.is_cacheable_since(before) {
            self.discriminated
                .insert((file, literal, context), narrowed);
        }
        narrowed
    }

    /// The same for the members `props` of a literal and a `context` that is a union. Also returns
    /// whether the types of all member values are cached and primitive: a value that may have a
    /// generic signature is rechecked for a call that is being resolved.
    fn discriminate_by_members(
        &mut self,
        file: FileId,
        props: Span<PropId>,
        context: TypeId,
    ) -> (TypeId, bool) {
        let hir = self.hir(file);
        // `getMatchingUnionConstituentForObjectLiteral`
        if let Some((name, constituents)) = self.key_property(context)
            && let Some(p) = props.iter().find(|&p| {
                hir[p].kind == PropKind::Init
                    && hir[p].key.name() == Some(*name)
                    && Self::is_possibly_discriminant_value(hir, hir[p].value)
            })
        {
            let (actual, is_final) = self.context_free_discriminant_type(file, hir[p].value);
            if let Some(&member) = constituents.get(&self.regular(actual))
                && member != TypeId::UNKNOWN
            {
                return (member, is_final);
            }
        }
        // Only names the binder knows count. A computed name is skipped.
        let (mut items, mut written) = (Discriminants::new(), SmallVec::<[Atom; 16]>::new());
        let mut is_given_for_good = true;
        for p in props.iter() {
            let prop = &hir[p];
            if prop.kind == PropKind::Spread {
                continue;
            }
            let Some(name) = prop.key.name() else {
                continue;
            };
            written.push(name);
            let counts = prop.value.is_some()
                && match prop.kind {
                    PropKind::Init => Self::is_possibly_discriminant_value(hir, prop.value),
                    PropKind::Shorthand => matches!(hir[prop.value].kind, ExprKind::Ident(_)),
                    _ => false,
                };
            if counts && self.is_discriminant_property(context, name) {
                let (actual, is_final) = self.context_free_discriminant_type(file, prop.value);
                is_given_for_good &= is_final;
                items.push((name, actual));
            }
        }
        self.push_omitted_discriminants(context, &written, &mut items);
        (
            self.discriminate_by_items(context, &items, Self::is_assignable),
            is_given_for_good,
        )
    }

    /// Whether the types computed since `before`, the value `non_cacheable_mark` returned then, are
    /// what any caller would get at any other time, with no flag raised or query marked in between.
    fn is_cacheable_since(&self, before: (u64, u64)) -> bool {
        self.non_cacheable_mark() == before
            // A result that depends on a call being resolved marks the queries started since the
            // call. If the call is the innermost query there is nothing to mark.
            && !self.is_innermost_tainted()
            && !matches!(self.stack.last(), Some(Query::Call(..)))
            // These are raised for the caller, every time.
            && !self.relation_too_complex
            && self.reliability == 0
            // A computation in progress is silently skipped, or its partial result is used, by any
            // caller that reaches it in the meantime.
            && self.instantiation_depth == 0
            && self.never_in_progress.is_empty()
            && self.variances_in_progress.is_empty()
            && self.awaiting.is_empty()
            && self.constraint_stack.is_empty()
            && self.reverse_mapped_source_stack.is_empty()
            && self.flow_loops.is_empty()
            && self.reporting_nonexistent.is_empty()
            && self.stack.iter().all(|q| {
                matches!(
                    q,
                    Query::Expr(..)
                        | Query::Call(..)
                        | Query::LiteralProp(..)
                        | Query::Pat(..)
                        | Query::ParameterSymbol(..)
                        | Query::Symbol(_)
                        | Query::Return(..)
                        | Query::ReturnOfSignature(_)
                        | Query::ReturnAtFirstLook(..)
                )
            })
    }

    /// `discriminateContextualTypeByJSXAttributes`: narrows the union `context`, the contextual
    /// type of the attributes of `element`, to the members the attributes can match.
    pub(super) fn discriminate_by_jsx_attributes(
        &mut self,
        file: FileId,
        element: ExprId,
        context: TypeId,
    ) -> TypeId {
        if !self.is_union(context) {
            return context;
        }
        let hir = self.hir(file);
        let ExprKind::Jsx(j) = hir[element].kind else {
            return context;
        };
        let (mut items, mut written) = (Discriminants::new(), SmallVec::<[Atom; 16]>::new());
        for p in hir[j].attrs.iter() {
            let attr = &hir[p];
            if attr.kind == PropKind::Spread {
                continue;
            }
            let Some(name) = attr.key.name() else {
                continue;
            };
            written.push(name);
            if (attr.value.is_none() || Self::is_possibly_discriminant_value(hir, attr.value))
                && self.is_discriminant_property(context, name)
            {
                // An attribute without a value is `true`.
                let actual = if attr.value.is_none() {
                    TypeId::TRUE
                } else {
                    self.context_free_discriminant_type(file, attr.value).0
                };
                items.push((name, actual));
            }
        }
        // The children between the tags count as given too.
        if hir
            .ids(hir[j].children)
            .any(|child| !matches!(hir[child].kind, ExprKind::Missing))
            && let super::jsx::JsxName::Name(children) =
                self.jsx_children_property_name(file, hir.node(element))
        {
            written.push(children);
        }
        self.push_omitted_discriminants(context, &written, &mut items);
        self.discriminate_by_items(context, &items, Self::is_assignable)
    }

    /// `isPossiblyDiscriminantValue`: the kinds of expression whose type does not depend on their
    /// contextual type.
    fn is_possibly_discriminant_value(hir: &File, e: ExprId) -> bool {
        match hir[e].kind {
            ExprKind::String(_)
            | ExprKind::Number(_)
            | ExprKind::BigInt(_)
            | ExprKind::Template { .. }
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Null
            | ExprKind::Ident(_) => true,
            ExprKind::Dot { obj, .. } => Self::is_possibly_discriminant_value(hir, obj),
            _ => false,
        }
    }

    /// `getContextFreeTypeOfExpression` for such an expression. Also returns whether the type is
    /// the same for any caller: it is a literal in the source, or it is cached and primitive. A
    /// value that may have a generic signature is rechecked for a call that is being resolved.
    fn context_free_discriminant_type(&mut self, file: FileId, e: ExprId) -> (TypeId, bool) {
        let actual = self.check_expression_with_contextual_type(
            file,
            e,
            TypeId::ANY,
            None,
            CheckMode::SKIP_CONTEXT_SENSITIVE,
        );
        // A literal in the source does not depend on the caller.
        let is_final = matches!(
            self.hir(file)[e].kind,
            ExprKind::String(_)
                | ExprKind::Number(_)
                | ExprKind::BigInt(_)
                | ExprKind::True
                | ExprKind::False
                | ExprKind::Null
        ) || self.every_type(actual, |c, t| c.is_primitive(t))
            && self.cached_type_of_expr(file, e) == Some(actual);
        (actual, is_final)
    }

    /// The second half of the discriminators: an optional discriminant property of the union
    /// `context` that is not in `written` is treated as `undefined`.
    fn push_omitted_discriminants(
        &mut self,
        context: TypeId,
        written: &[Atom],
        items: &mut Discriminants,
    ) {
        // `getPropertiesOfType`
        let reduced = self.reduced(context);
        let mut visited: SmallVec<[Members<'p>; 2]> = SmallVec::new();
        for &part in self.parts(reduced) {
            let Some(members) = self.members(part) else {
                break;
            };
            for prop in &members.shape().props {
                let name = prop.name;
                // Each name once.
                if visited
                    .iter()
                    .any(|earlier| earlier.resolved.prop(name).is_some())
                    || members
                        .resolved
                        .prop(name)
                        .is_some_and(|first| !std::ptr::eq(first, prop))
                {
                    continue;
                }
                if written.contains(&name) || !self.is_discriminant_property(context, name) {
                    continue;
                }
                // `createUnionOrIntersectionProperty`: it is optional if it is optional in some
                // member.
                let mut is_optional = false;
                for &m in self.parts(reduced) {
                    is_optional |= self
                        .prop_ref(m, name)
                        .is_some_and(|(p, _)| p.flags.contains(PropFlags::OPTIONAL));
                }
                // A property that some member lacks is not a property of the union.
                if is_optional && self.type_of_property(reduced, name).is_some() {
                    items.push((name, TypeId::UNDEFINED));
                }
            }
            // `getPropertiesOfUnionOrIntersectionType`: a property that all members have is a
            // property of the first member without index signatures.
            if members.shape().index.is_empty() {
                break;
            }
            visited.push(members);
        }
    }

    /// `discriminateTypeByDiscriminableItems`. `items`: property names, each with the type of the
    /// value given for it.
    /// `is_related_to`: `isRelatedTo` of a `TypeDiscriminator`, as "is not `TernaryFalse`".
    pub(super) fn discriminate_by_items(
        &mut self,
        context: TypeId,
        items: &[(Atom, TypeId)],
        mut is_related_to: impl FnMut(&mut Self, TypeId, TypeId) -> bool,
    ) -> TypeId {
        const OUT: u8 = 0;
        const IN: u8 = 1;
        const MAYBE: u8 = 2;
        let types = self.parts(context);
        let mut include: SmallVec<[u8; 16]> = SmallVec::with_capacity(types.len());
        for &t in types {
            include.push(if !self.is_primitive(t) && !self.reduced(t).is_never() {
                IN
            } else {
                OUT
            });
        }
        for &(name, actual) in items {
            // Non-matching members are removed only if some member matches: a discriminant that
            // matches nothing excludes nothing.
            let mut matched = false;
            for (i, &t) in types.iter().enumerate() {
                if include[i] == OUT {
                    continue;
                }
                let Some(expected) = self.type_of_property_or_index_signature_of_type(t, name)
                else {
                    continue;
                };
                // `Distributed`: `never` is one type, and it is related to every type.
                if actual.is_never()
                    || (self.parts(actual).iter()).any(|&s| is_related_to(self, s, expected))
                {
                    matched = true;
                } else {
                    include[i] = MAYBE;
                }
            }
            for slot in &mut include {
                if *slot == MAYBE {
                    *slot = if matched { OUT } else { IN };
                }
            }
        }
        if !include.contains(&OUT) {
            return context;
        }
        let kept: Parts = types
            .iter()
            .zip(&include)
            .filter(|(_, slot)| **slot == IN)
            .map(|(&t, _)| t)
            .collect();
        if kept.is_empty() {
            context
        } else {
            self.union_unreduced(&kept)
        }
    }

    fn contextual_type_in_expr(
        &mut self,
        file: FileId,
        e: ExprId,
        parent: ExprId,
        context_flags: ContextFlags,
    ) -> Option<TypeId> {
        let hir = self.hir(file);
        match hir[parent].kind {
            ExprKind::Call(c) | ExprKind::New(c) | ExprKind::TaggedTemplate(c) => {
                if hir[c].callee == e || hir[c].template == e {
                    return None;
                }
                self.contextual_type_for_argument(file, parent, e)
            }
            // `getContextualTypeForYieldOperand`
            ExprKind::Yield { star, .. } => {
                let func = self.get_containing_function(file, parent)?;
                let declared =
                    self.declared_or_contextual_return_type(file, func, context_flags)?;
                let is_async = hir[func].flags.contains(Flags::ASYNC);
                if !star {
                    let declared = self.alternatives_to_go_through(declared, is_async);
                    let types =
                        self.iteration_type_of_generator_function_return_type(declared, is_async);
                    return types.y;
                }
                // An iterable that yields the contextual yield type.
                let types = self.generator_return_types(declared, is_async);
                let yielded = types.y.unwrap_or(TypeId::SILENT_NEVER);
                let returned = self
                    .contextual_type(file, parent, context_flags)
                    .map_or(TypeId::SILENT_NEVER, |t| self.without_pattern_marks(t));
                let next = types.n.unwrap_or(TypeId::UNKNOWN);
                let generator = self.generator_of(yielded, returned, next, false);
                if is_async {
                    let asynchronous = self.generator_of(yielded, returned, next, true);
                    return Some(self.union(&[generator, asynchronous]));
                }
                Some(generator)
            }
            ExprKind::Array(items) => {
                let context = self.apparent_type_of_contextual_type(file, parent, context_flags)?;
                let index = hir.ids(items).position(|i| i == e)?;
                // `getSpreadIndices`
                let is_spread = |i: ExprId| matches!(hir[i].kind, ExprKind::Spread(_));
                let first = hir.ids(items).position(is_spread);
                let last = first.and_then(|_| hir.ids(items).rposition(is_spread));
                self.contextual_element_at(context, index, Some(items.len()), first, last)
            }
            // An expression spread into an array or an argument list has no contextual type. A
            // spread child of an element is a `JsxExpression`.
            ExprKind::Spread(_) => match self.bound(file).expr_parent[parent.idx()] {
                Parent::Expr(element) if matches!(hir[element].kind, ExprKind::Jsx(_)) => {
                    self.contextual_type(file, parent, context_flags)
                }
                _ => None,
            },
            ExprKind::Cond { test, .. } => {
                if test == e {
                    return None;
                }
                self.contextual_type(file, parent, context_flags)
            }
            // `getContextualTypeForBinaryOperand`
            ExprKind::Binary { op, left, right } => match op {
                // The implied type of a pattern is not a contextual type for the right operand: the
                // type of the left operand is.
                BinOp::Or | BinOp::Nullish => {
                    let context = self.contextual_type(file, parent, context_flags);
                    if e == right
                        && context.is_none_or(|t| {
                            self.is_expected_by_pattern(file, parent, t, context_flags)
                        })
                    {
                        return Some(self.get_type_of_expression(file, left));
                    }
                    context
                }
                BinOp::And | BinOp::Comma if e == right => {
                    self.contextual_type(file, parent, context_flags)
                }
                _ => None,
            },
            ExprKind::Assign { op, target, value } => {
                // `binary.Type`
                let annotation = hir.jsdoc_type(JsDocTypeOwner::Assign(parent));
                if annotation.is_some() {
                    return Some(self.type_from_node(file, annotation));
                }
                if e != value || !matches!(op, None | Some(BinOp::Or | BinOp::Nullish | BinOp::And))
                {
                    return None;
                }
                // `{ a = e }` is a `ShorthandPropertyAssignment`: `getContextualTypeForObjectLiteralElement`.
                if matches!(self.bound(file).expr_parent[parent.idx()], Parent::Prop(p) if hir[p].kind == PropKind::Shorthand)
                {
                    return self.contextual_type(file, parent, context_flags);
                }
                let mut leftmost = target;
                while !is_parenthesized(hir, leftmost) {
                    leftmost = match hir[leftmost].kind {
                        ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => obj,
                        ExprKind::Call(c) | ExprKind::TaggedTemplate(c) => hir[c].callee,
                        ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } => expr,
                        ExprKind::AsConst(x) | ExprKind::NonNull(x) => x,
                        _ => break,
                    };
                }
                if !is_parenthesized(hir, leftmost)
                    && let ExprKind::Ident(name) = hir[leftmost].kind
                    && self
                        .symbol_of_identifier(file, leftmost, name)
                        .is_some_and(|s| self.files().flags(s).contains(SymFlags::MODULE_EXPORTS))
                {
                    return None;
                }
                self.contextual_type_for_assignment(file, parent, target)
            }
            ExprKind::As { ty, .. } | ExprKind::Satisfies { ty, .. } => {
                Some(self.type_from_node(file, ty))
            }
            ExprKind::NonNull(_) | ExprKind::AsConst(_) => {
                self.contextual_type(file, parent, context_flags)
            }
            // `getContextualTypeForAwaitOperand`
            ExprKind::Await(_) => {
                let context = self.contextual_type(file, parent, context_flags)?;
                let context = self.without_pattern_marks(context);
                self.awaited_or_promise_like(context)
            }
            // `getContextualTypeForArgumentAtIndex`: for an `import()`, a string, an
            // `ImportCallOptions`, and `any`.
            ExprKind::ImportCall { args, .. } => {
                if e == hir.id_at(args, 0) {
                    return Some(TypeId::STRING);
                }
                if hir.ids(args).nth(1) != Some(e) {
                    return Some(TypeId::ANY);
                }
                let name = self.atoms().lookup(b"ImportCallOptions")?;
                let sym = self.global_type_symbol(name)?;
                Some(self.declared_type(sym))
            }
            // `getContextualTypeForChildJsxExpression`
            ExprKind::Jsx(j) => {
                // `GetSemanticJsxChildren`: `{}` is not a child. Neither are the names in the tags.
                let (mut count, mut index) = (0usize, None);
                for child in hir.ids(hir[j].children) {
                    if matches!(hir[child].kind, ExprKind::Missing) {
                        continue;
                    }
                    if child == e {
                        index = Some(count);
                    }
                    count += 1;
                }
                let index = index?;
                let props = self.apparent_type_of_contextual_type_of_jsx_attributes(
                    file,
                    parent,
                    context_flags,
                )?;
                let super::jsx::JsxName::Name(children) =
                    self.jsx_children_property_name(file, hir.node(parent))
                else {
                    return None;
                };
                let field = self.contextual_property(props, children)?;
                if count == 1 {
                    return Some(field);
                }
                // With several children, the contextual type of each is the element type of the
                // list at its index.
                let key = self.number_literal(index as f64, false);
                let mut types = Parts::with_capacity(self.parts(field).len());
                for &t in self.parts(field) {
                    types.push(if self.is_array_like(t) {
                        self.indexed_access(t, key)
                    } else {
                        t
                    });
                }
                Some(self.union_unreduced(&types))
            }
            _ => None,
        }
    }

    /// `getContextualTypeForAssignmentExpression`: the contextual type of the assigned value is the
    /// declared type of the target, unless the assignment is itself the declaration.
    fn contextual_type_for_assignment(
        &mut self,
        file: FileId,
        assignment: ExprId,
        target: ExprId,
    ) -> Option<TypeId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if let ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } = hir[target].kind {
            match hir[obj].kind {
                // `f.id = value`, where that makes `id` a property of the function `f`.
                ExprKind::Ident(name) => {
                    // The values exported by `module.exports = value` and `exports.a = value` have
                    // no contextual type.
                    if self
                        .symbol_of_identifier(file, obj, name)
                        .is_some_and(|s| self.files().flags(s).contains(SymFlags::MODULE_EXPORTS))
                    {
                        return None;
                    }
                    // `binary.Symbol != nil`: `bindExportsOrObjectDefineProperty` and
                    // `bindModuleExportsAssignment` are purely syntactic, whatever `exports` and
                    // `module` resolve to here.
                    if bound.is_expando_declaration(assignment)
                        || bound.commonjs_indicator.is_some()
                            && matches!(
                                crate::bind::assignment_declaration_kind(hir, assignment),
                                crate::bind::JsDeclarationKind::ModuleExports
                                    | crate::bind::JsDeclarationKind::ExportsProperty(_)
                            )
                    {
                        // An annotated variable provides the contextual types of its properties.
                        let symbol = bound.expr_symbol[obj.idx()];
                        if symbol.is_some()
                            && let Some(pat) =
                                bound.symbols[symbol.idx()]
                                    .decls
                                    .iter()
                                    .find_map(|&d| match d {
                                        crate::bind::Decl::Var(pat) => Some(pat),
                                        _ => None,
                                    })
                            && let PatParent::Var(d) = bound.pat_parent[pat.idx()]
                            && hir[d].ty.is_some()
                        {
                            let declared = self.type_from_node(file, hir[d].ty);
                            return match hir[target].kind {
                                ExprKind::Dot { name, .. } => {
                                    self.contextual_property(declared, name)
                                }
                                ExprKind::Index { index, .. } => {
                                    let key = self.type_of_expr(file, index);
                                    match self.property_name_of_type(key) {
                                        Some(name) => {
                                            self.contextual_property_ex(declared, name, Some(key))
                                        }
                                        None => Some(self.get_type_of_expression(file, target)),
                                    }
                                }
                                _ => None,
                            };
                        }
                        return None;
                    }
                }
                // `a.f.id = value`, `module.exports.id = value`, the same.
                ExprKind::Dot { .. } | ExprKind::Index { .. } => {
                    if bound.is_expando_declaration(assignment)
                        || !matches!(
                            crate::bind::assignment_declaration_kind(hir, assignment),
                            crate::bind::JsDeclarationKind::None
                        )
                    {
                        return None;
                    }
                }
                // `this.x = value`, where `x` is declared without an annotation: its type comes
                // from the assignments.
                ExprKind::This => {
                    // In JavaScript the assignment may be the declaration of the property
                    // (`binary.Symbol != nil`): it has no contextual type, unless the first
                    // declaration has an annotation (`binary.Symbol.ValueDeclaration.Type()`).
                    let symbol = bound.symbol_of_declaration(Decl::ThisProperty(assignment));
                    if symbol.is_some()
                        && let Some((of, Decl::ThisProperty(first))) = self
                            .files()
                            .value_declaration(self.files().sym(file, symbol))
                        && (self.hir(of).jsdoc_type(JsDocTypeOwner::Assign(first))).is_none()
                    {
                        return None;
                    }
                    if self.declares_member_of_object_literal(file, assignment, obj) {
                        return None;
                    }
                    let this = self.get_type_of_expression(file, obj);
                    let this = self.apparent_type(this);
                    let name = match hir[target].kind {
                        ExprKind::Dot { name, .. } => Some(name),
                        ExprKind::Index { index, .. } => {
                            let key = self.type_of_expr(file, index);
                            self.property_name_of_type(key)
                        }
                        _ => None,
                    };
                    if let Some(name) = name
                        && let Some((prop, _)) = self.prop_ref(this, name)
                        && let PropSource::Symbol(sym) = prop.source
                        && let Some((of, Decl::Member(m))) = self.files().value_declaration(sym)
                    {
                        let member = &self.hir(of)[m];
                        if member.kind == MemberKind::Property
                            && member.ty.is_none()
                            && member.init.is_none()
                        {
                            return None;
                        }
                    }
                }
                _ => {}
            }
        }
        // `getTypeOfExpression(left)`
        Some(self.get_type_of_expression(file, target))
    }

    /// `bindThisPropertyAssignment`, `getThisClassAndSymbolTable`: whether `assignment`, which assigns to a property of `this`, is in
    /// a method or an accessor of an object literal in JavaScript. It declares a member of the symbol of the literal then
    /// (`binary.Symbol != nil`). Not if a property of that name has a type of its own (`ValueDeclaration.Type() != nil`).
    fn declares_member_of_object_literal(
        &self,
        file: FileId,
        assignment: ExprId,
        this: ExprId,
    ) -> bool {
        use crate::bind::{JsDeclarationKind, assignment_declaration_kind};
        let (hir, bound) = (self.hir(file), self.bound(file));
        if assignment_declaration_kind(hir, assignment) != JsDeclarationKind::ThisProperty {
            return false;
        }
        let ExprKind::Assign { target, .. } = hir[assignment].kind else {
            return false;
        };
        let name = match hir[target].kind {
            // `this.#name = value` declares nothing.
            ExprKind::Dot { name_pos, .. } if is_private_name_at(hir, name_pos) => {
                return false;
            }
            ExprKind::Dot { name, .. } => name,
            _ => Atom::NONE,
        };
        let Some(Ok(func)) = self.this_container(file, this) else {
            return false;
        };
        if !matches!(
            hir[func].kind,
            FnKind::Method | FnKind::Getter | FnKind::Setter
        ) {
            return false;
        }
        let FnOwner::Expr(owner) = bound.fns[func.idx()].owner else {
            return false;
        };
        let Parent::Prop(p) = bound.expr_parent[owner.idx()] else {
            return false;
        };
        let ExprKind::Object(props) = hir[bound.prop_owner[p.idx()]].kind else {
            return false;
        };
        !props.iter().any(|x| {
            hir[x].key == PropKey::Name(name) && hir.jsdoc_type(JsDocTypeOwner::Prop(x)).is_some()
        })
    }

    /// `getContextualTypeForElementExpression`. `length`: the number of elements, if known.
    /// `first_spread`, `last_spread`: the indexes of the first and the last `...` among them.
    pub(super) fn contextual_element_at(
        &mut self,
        context: TypeId,
        index: usize,
        length: Option<usize>,
        first_spread: Option<usize>,
        last_spread: Option<usize>,
    ) -> Option<TypeId> {
        // `mapTypeEx`
        if context.is_never() {
            return Some(context);
        }
        let variable = ElemFlags::REST | ElemFlags::VARIADIC;
        let before_spreads = first_spread.is_none_or(|s| index < s);
        let mut types = Parts::new();
        for &part in self.parts(context) {
            if let TypeData::Tuple { flags, .. } = self.data(part) {
                let elems = self.type_arguments(part);
                let fixed = Self::fixed_length(flags);
                if before_spreads && index < fixed {
                    let element = elems[index];
                    // An optional element also includes `undefined`, whether or not that is stored
                    // with the element.
                    let is_optional = flags[index].contains(ElemFlags::OPTIONAL);
                    let element = if is_optional {
                        self.optional_property(element)
                    } else {
                        element
                    };
                    types.push(self.remove_missing_type(element, is_optional));
                    continue;
                }
                // The distance of the element from the end, if known, and the length of the fixed
                // suffix of the tuple.
                let offset = match length {
                    Some(n) if last_spread.is_none_or(|s| index > s) => n.saturating_sub(index),
                    _ => 0,
                };
                let fixed_end = if offset > 0 && fixed < flags.len() {
                    flags
                        .iter()
                        .rev()
                        .take_while(|f| !f.intersects(variable))
                        .count()
                } else {
                    0
                };
                if offset > 0 && offset <= fixed_end {
                    types.push(elems[elems.len() - offset]);
                    continue;
                }
                let from = first_spread.map_or(fixed, |s| fixed.min(s));
                let end_skip = match (length, last_spread) {
                    (Some(n), Some(s)) => fixed_end.min(n.saturating_sub(s)),
                    _ => fixed_end,
                };
                if let Some(t) = self.element_type_of_slice(elems, flags, from, end_skip, true) {
                    types.push(t);
                }
                continue;
            }
            // FOR SPEED: both its index signature and what it yields.
            if let Some(element) = self.array_element(part) {
                types.push(element);
                continue;
            }
            if before_spreads {
                let name = self.number_name(index as f64);
                if let Some(t) = self.contextual_property(part, name) {
                    types.push(t);
                    continue;
                }
            }
            let usage = IterationUse::Element;
            let element = self.iterated_type_or_element_type(usage, part, TypeId::UNDEFINED, None);
            types.extend(element.filter(|&element| element != TypeId::UNRESOLVED));
        }
        if types.is_empty() {
            None
        } else {
            Some(self.union_unreduced(&types))
        }
    }

    // ───────────────────────────── functions ─────────────────────────────

    pub(super) fn takes_context(&self, file: FileId, func: FnId) -> Option<ExprId> {
        let f = &self.hir(file)[func];
        match (f.kind, self.bound(file).fns[func.idx()].owner) {
            (FnKind::Expr | FnKind::Arrow | FnKind::Method, FnOwner::Expr(owner)) => Some(owner),
            _ => None,
        }
    }

    /// `getContextualSignature`: the signature a function expression is expected to have.
    pub fn contextual_signature(&mut self, file: FileId, func: FnId) -> Option<SigId> {
        let owner = self.takes_context(file, func)?;
        let context =
            self.apparent_type_of_contextual_type(file, owner, ContextFlags::SIGNATURE)?;
        self.contextual_signature_in(file, func, context)
    }

    /// The same for a function expression whose contextual type is `context`.
    pub(super) fn contextual_signature_in(
        &mut self,
        file: FileId,
        func: FnId,
        context: TypeId,
    ) -> Option<SigId> {
        // `getApparentType`: a type parameter is replaced by its constraint, also inside an
        // intersection.
        let context = self.map_type_unreduced(context, |c, m| {
            if c.is_deferred(m) || matches!(c.data(m), TypeData::Intersection(_)) {
                c.base_constraint(m)
            } else {
                m
            }
        });
        let required = self.required_own_params(file, func);
        let mut found: SmallVec<[SigId; 4]> = SmallVec::new();
        // The members that can have a signature.
        let parts: Parts = self
            .parts(context)
            .iter()
            .copied()
            .filter(|&part| !self.is_primitive(part))
            .collect();
        for part in parts {
            // `getContextualCallSignature`
            let mut fitting: SmallVec<[SigId; 4]> = SmallVec::new();
            for s in self.signatures(part, false) {
                if !self.is_arity_smaller(s, required) {
                    fitting.push(s);
                }
            }
            let sig = match fitting[..] {
                [] => continue,
                [only] => only,
                _ => match self.intersected_signature(&fitting) {
                    Some(combined) => combined,
                    None => continue,
                },
            };
            // The members of a union must agree on everything but `this` and the return type.
            if let Some(&first) = found.first()
                && !self
                    .compare_signatures_identical(
                        first,
                        sig,
                        PartialMatch::No,
                        IgnoreThisTypes::Yes,
                        IgnoreReturnTypes::Yes,
                        &mut Self::compare_types_identical,
                    )
                    .holds()
            {
                return None;
            }
            found.push(sig);
        }
        match found[..] {
            [] => None,
            [only] => Some(only),
            [first, ..] if found.iter().all(|&s| s == first) => Some(first),
            // `createUnionSignature`: the first, returning the union of their return types.
            [first, ..] => {
                let (type_params, params, this) = (
                    self.sig_type_params(first),
                    self.sig_params(first),
                    self.sig_this_type(first),
                );
                Some(self.types().intern_sig(SigData::Synth {
                    type_params: self.list(&type_params),
                    params: self.list(&params),
                    ret: TypeId::UNRESOLVED,
                    this,
                    of: self.list(&found),
                    is_union: true,
                }))
            }
        }
    }

    /// `getContextualCallSignature`: the call signature of `ty` that is applicable to `func`, based
    /// on the number of parameters it requires.
    pub(super) fn contextual_call_signature(
        &mut self,
        file: FileId,
        func: FnId,
        ty: TypeId,
    ) -> Option<SigId> {
        let required = self.required_own_params(file, func);
        let mut fitting: SmallVec<[SigId; 4]> = SmallVec::new();
        for s in self.signatures(ty, false) {
            if !self.is_arity_smaller(s, required) {
                fitting.push(s);
            }
        }
        match fitting[..] {
            [] => None,
            [only] => Some(only),
            _ => self.intersected_signature(&fitting),
        }
    }

    /// `getIntersectedSignatures`: a single signature for a function that must satisfy all of
    /// `sigs`.
    pub(super) fn intersected_signature(&mut self, sigs: &[SigId]) -> Option<SigId> {
        if !self.p.files.options.no_implicit_any {
            return None;
        }
        let mut combined: Option<SigId> = None;
        for &sig in sigs {
            combined = Some(match combined {
                None => sig,
                Some(so_far) if so_far == sig => sig,
                Some(so_far) => {
                    let (left, right) = (self.sig_type_params(so_far), self.sig_type_params(sig));
                    if !self.type_parameters_identical(&left, &right) {
                        return None;
                    }
                    self.combine_member_signatures(so_far, sig, false)
                }
            });
        }
        combined
    }

    /// The `targetParameterCount` of `isAritySmaller`: the number of parameters of `func` before
    /// the first optional one.
    fn required_own_params(&self, file: FileId, func: FnId) -> usize {
        let hir = self.hir(file);
        hir[func]
            .params
            .iter()
            .take_while(|&p| {
                !hir[p].flags.intersects(Flags::OPTIONAL | Flags::REST) && hir[p].default.is_none()
            })
            .count()
    }

    /// `isAritySmaller`: `sig`, a contextual signature candidate for `func`, accepts fewer
    /// arguments than `func` has parameters (`required`), and so does not apply.
    fn is_arity_smaller(&mut self, sig: SigId, required: usize) -> bool {
        // `signatureHasRestParameter`: without one no type of a parameter is requested. In a JSDoc
        // type that is never checked, requesting one reports what nothing else reports.
        if let SigData::Decl { file, func, .. } = *self.types().sig(sig) {
            let hir = self.hir(file);
            let params = hir[func].params;
            if matches!(hir[func].body, FnBody::None)
                && !params.iter().any(|p| hir[p].flags.contains(Flags::REST))
            {
                return params.len() < required;
            }
        }
        let params = self.sig_params(sig);
        !self.has_effective_rest_parameter(&params) && self.parameter_count(&params) < required
    }

    /// `getInferenceContext`: the index in `inference_contexts` of the context `e` is checked
    /// under.
    pub(super) fn get_inference_context(&self, file: FileId, e: ExprId) -> Option<usize> {
        self.inference_contexts
            .iter()
            .rposition(|info| info.file == file && self.is_node_descendant_of(file, e, info.node))
    }

    /// `IsNodeDescendantOf`
    fn is_node_descendant_of(&self, file: FileId, e: ExprId, ancestor: ExprId) -> bool {
        let hir = self.hir(file);
        let ancestor = hir.node(ancestor);
        hir.find_ancestor(hir.node(e), |n| n == ancestor).is_some()
    }

    /// Whether `sig` is the signature `func` declares, not an instantiation of it.
    pub(super) fn is_signature_of_declaration(&self, sig: SigId, file: FileId, func: FnId) -> bool {
        matches!(
            *self.types().sig(sig),
            SigData::Decl { file: f, func: g, mapper }
                if f == file
                    && g == func
                    && self.types().mapping(mapper).iter().all(|&(from, to)| from == to)
        )
    }

    /// `contextualSignature == c.getSignatureFromDeclaration(fn)`
    pub(super) fn is_own_contextual_signature(&mut self, file: FileId, func: FnId) -> bool {
        self.contextual_signature(file, func)
            .is_some_and(|sig| self.is_signature_of_declaration(sig, file, func))
    }

    /// The signature passed to `assignContextualParameterTypes` for `func`. Before `func` is
    /// checked: `getContextualSignature`.
    pub(super) fn assigned_contextual_signature(
        &mut self,
        file: FileId,
        func: FnId,
    ) -> Option<SigId> {
        if let Some(assigned) = self.context_checked(file, func) {
            return assigned;
        }
        let pulled = self.contextual_signature(file, func);
        // `getResolvedSignature` of the enclosing call may have reached the function.
        self.context_checked(file, func).unwrap_or(pulled)
    }

    /// `getContextuallyTypedParameterType` for parameter `index` of `func`. Once `func` is checked:
    /// what `assignContextualParameterTypes` read from the signature it was passed.
    pub fn contextual_param_type(
        &mut self,
        file: FileId,
        func: FnId,
        index: usize,
    ) -> Option<TypeId> {
        // `isContextSensitiveFunctionOrObjectLiteralMethod`
        let owner = self.takes_context(file, func)?;
        if !self.is_context_sensitive(file, owner) {
            return None;
        }
        if let Some(actual) = self.iife_param_type(file, func, index) {
            return actual;
        }
        let sig = self.assigned_contextual_signature(file, func)?;
        self.contextual_param_type_in(file, func, index, sig)
    }

    /// `getContextuallyTypedParameterType`, where `contextualSignature` is `sig`.
    pub(super) fn contextual_param_type_in(
        &mut self,
        file: FileId,
        func: FnId,
        index: usize,
        sig: SigId,
    ) -> Option<TypeId> {
        let params = self.sig_params(sig);
        let own = self.hir(file)[func].params;
        if self.hir(file)[own.at(index)].flags.contains(Flags::REST) && index + 1 == own.len() {
            return Some(self.rest_type_at_position(&params, index, false));
        }
        // `tryGetTypeAtPosition`: there is nothing past the end of a rest tuple of fixed length.
        // `assignParameterType` then calls `getContextuallyTypedParameterType`, which sees the
        // signature as the callee declares it: for `...args: U`, `U[index]`.
        if let Some(ty) = self.param_type_at(&params, index) {
            return Some(ty);
        }
        let open = self.contextual_signature(file, func)?;
        let open = self.sig_params(open);
        self.param_type_at(&open, index)
    }

    /// `getContextualReturnType`: the annotated return type of `func`, or its contextual return
    /// type, as a whole.
    pub(super) fn declared_or_contextual_return_type(
        &mut self,
        file: FileId,
        func: FnId,
        context_flags: ContextFlags,
    ) -> Option<TypeId> {
        let f = &self.hir(file)[func];
        if let Some(returned) = self.return_type_from_annotation(file, func) {
            return Some(returned);
        }
        // The contextual type of a function may be the type of the function itself, where a type
        // argument was inferred from it. On its first check TypeScript then computes the return
        // type again, this time with that resolution in progress, and caches the result.
        if let Some(sig) = self.contextual_signature(file, func)
            && !self.is_resolving_return_type(sig)
            && !self.is_at_first_look(sig)
        {
            let expected = self.sig_return(sig);
            let (is_generator, is_async) = (
                f.flags.contains(Flags::GENERATOR),
                f.flags.contains(Flags::ASYNC),
            );
            if !is_generator && !is_async {
                return Some(expected);
            }
            // The union members that the result of such a function can be. For a non-union type,
            // that type or nothing.
            let fitting = self.filter(expected, |c, t| {
                if c.is_any(t)
                    || t == TypeId::UNKNOWN
                    || t == TypeId::VOID
                    || c.is_instantiable_non_primitive(t)
                {
                    return true;
                }
                if !is_generator {
                    // `getAwaitedTypeOfPromise(t) != nil`
                    return match c.thenable_value(t) {
                        Some(promised) => c.awaited_or_none(promised).is_some(),
                        None => false,
                    };
                }
                c.check_generator_instantiation_assignability_to_return_type(t, is_async, None)
            });
            return Some(fitting);
        }
        // For an immediately invoked function, the contextual type of the call.
        let (hir, bound) = (self.hir(file), self.bound(file));
        let FnOwner::Expr(e) = bound.fns[func.idx()].owner else {
            return None;
        };
        let Parent::Expr(call) = bound.expr_parent[e.idx()] else {
            return None;
        };
        if !matches!(hir[call].kind, ExprKind::Call(c) if hir[c].callee == e) {
            return None;
        }
        self.contextual_type(file, call, context_flags)
    }

    /// `TypeFlagsInstantiableNonPrimitive`: a type variable, a conditional type or `NoInfer<T>`, but not `keyof T`.
    pub(super) fn is_instantiable_non_primitive(&self, ty: TypeId) -> bool {
        self.is_type_variable(ty)
            || self.is_no_infer(ty)
            || matches!(
                self.data(ty),
                TypeData::Cond { .. } | TypeData::Substitution { .. }
            )
    }

    /// Whether `sig` belongs to a function that is being checked for the first time: see
    /// `Query::ReturnAtFirstLook`.
    fn is_at_first_look(&self, sig: SigId) -> bool {
        match *self.types().sig(sig) {
            SigData::Decl { file, func, .. } => {
                let q = Query::ReturnAtFirstLook(file, func);
                self.may_be_in_flight(q) && self.stack.contains(&q)
            }
            SigData::Synth { ref of, .. } => of.iter().any(|&s| self.is_at_first_look(s)),
            _ => false,
        }
    }

    /// Whether the return type of the declaration of `sig` is being resolved, whatever the mapper of `sig` is. For callers that must
    /// not read a return type at a point where tsgo does not read it.
    pub(super) fn is_resolving_return_type_of_declaration(&self, sig: SigId) -> bool {
        match *self.types().sig(sig) {
            SigData::Decl { file, func, .. } => self.is_resolving(Query::Return(file, func)),
            SigData::Synth { ref of, .. } => of
                .iter()
                .any(|&s| self.is_resolving_return_type_of_declaration(s)),
            _ => false,
        }
    }

    /// `isResolvingReturnTypeOfSignature`
    pub(super) fn is_resolving_return_type(&self, sig: SigId) -> bool {
        match *self.types().sig(sig) {
            SigData::Decl { mapper, .. } if self.is_instantiating(mapper) => {
                self.is_resolving(Query::ReturnOfSignature(sig))
            }
            SigData::Synth { ref of, .. } => {
                of.iter().any(|&s| self.is_resolving_return_type(s))
                    || self.is_resolving(Query::ReturnOfSignature(sig))
            }
            _ => self.is_resolving_return_type_of_declaration(sig),
        }
    }

    /// `getContextualTypeForReturnExpression`, `getContextualTypeForYieldOperand`: of the union
    /// members of a generator's return type, those that have an iteration return type.
    fn alternatives_to_go_through(&mut self, declared: TypeId, is_async: bool) -> TypeId {
        if self.is_union(declared) {
            self.filter(declared, |c, t| {
                let types = c.iteration_type_of_generator_function_return_type(t, is_async);
                types.r.is_some()
            })
        } else {
            declared
        }
    }

    /// The contextual type of the `return` expressions of `func`.
    pub(super) fn contextual_return_type(
        &mut self,
        file: FileId,
        func: FnId,
        context_flags: ContextFlags,
    ) -> Option<TypeId> {
        let f = &self.hir(file)[func];
        // `getTypeFromTypeNode` for a type predicate.
        if f.ret.is_some()
            && let TypeNodeKind::Predicate { asserts, .. } = self.hir(file)[f.ret].kind
        {
            return Some(if asserts {
                TypeId::VOID
            } else {
                TypeId::BOOLEAN
            });
        }
        let mut declared = self.declared_or_contextual_return_type(file, func, context_flags)?;
        if f.flags.contains(Flags::GENERATOR) {
            // Its return value is the last result delivered to the consumer of the iterator.
            let is_async = f.flags.contains(Flags::ASYNC);
            declared = self.alternatives_to_go_through(declared, is_async);
            let types = self.iteration_type_of_generator_function_return_type(declared, is_async);
            declared = types.r?;
        }
        if f.flags.contains(Flags::ASYNC) {
            return self.awaited_or_promise_like(declared);
        }
        Some(declared)
    }

    /// `A | PromiseLike<A>`, where `A` is `getAwaitedTypeNoAlias(ty)`: a type variable that may be a promise stays itself instead of
    /// becoming `Awaited<T>`. `None` if `ty` has no awaited type, or the awaited type is unknown.
    pub(super) fn awaited_or_promise_like(&mut self, ty: TypeId) -> Option<TypeId> {
        let awaited = self.awaited_no_alias(ty)?;
        if awaited == TypeId::UNRESOLVED {
            return None;
        }
        let promise = self.create_promise_like_type(awaited);
        Some(self.union(&[awaited, promise]))
    }

    /// `createPromiseLikeType`: `unknown` if `getGlobalPromiseLikeType` finds no `PromiseLike`.
    fn create_promise_like_type(&mut self, promised_type: TypeId) -> TypeId {
        let Some(target) = self.get_global_type(known::PromiseLike, 1, true) else {
            return TypeId::UNKNOWN;
        };
        let unwrapped = self.unwrap_awaited_type(promised_type);
        let promised_type = self.awaited_no_alias(unwrapped);
        self.intern_key(TypeKey::Ref {
            target,
            args: &[promised_type.unwrap_or(TypeId::UNKNOWN)],
        })
    }
}

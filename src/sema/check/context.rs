//! What an expression is expected to be, going by where it is written.

use super::infer::Parts;
use super::*;
use crate::bind::{FnOwner, Parent, PatParent};
use smallvec::SmallVec;

/// The names of properties that tell the members of a union apart, and what each is given as.
type Discriminants = SmallVec<[(Atom, TypeId); 8]>;

impl<'p> Checker<'p> {
    /// The function-like `e` is evaluated in.
    #[inline]
    pub fn enclosing_fn_of_expr(&self, file: FileId, e: ExprId) -> Option<FnId> {
        self.enclosing_fn(file, self.bound(file).expr_parent[e.idx()])
    }

    pub fn enclosing_fn(&self, file: FileId, mut parent: Parent) -> Option<FnId> {
        let bound = self.bound(file);
        loop {
            parent = match parent {
                Parent::Expr(e) => bound.expr_parent[e.idx()],
                Parent::Stmt(s) if s.is_some() => bound.stmt_parent[s.idx()],
                Parent::VarInit(d) => Parent::Stmt(bound.var_stmt[d.idx()]),
                Parent::Prop(p) => bound.expr_parent[bound.prop_owner[p.idx()].idx()],
                Parent::Case(c) => Parent::Stmt(bound.case_stmt[c.idx()]),
                Parent::FnBody(f) => return Some(f),
                Parent::ParamDefault(p) => return Some(bound.param_fn[p.idx()]),
                _ => return None,
            };
        }
    }

    /// Resolves the calls that decide what the parameters of the functions around `e` are, outermost first, so that
    /// a question about something inside does not come back to itself through them.
    pub fn prepare_enclosing(&mut self, file: FileId, e: ExprId) {
        self.prepare_around(file, e);
        self.prepare_context(file, e);
    }

    /// `prepare_parent`, of what `e` is part of. In the file that is being checked, `e` and the expressions it is part of are
    /// marked on the way up. What is part of one that is marked is in the same function, and that has been through
    /// `prepare_from_the_outside`.
    fn prepare_around(&mut self, file: FileId, e: ExprId) {
        let bound = self.bound(file);
        if self.prepared_exprs.0 != file {
            if self.checking != Some(file) {
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

    /// The same for a question about the parameters or the result of `func`.
    pub fn prepare_fn(&mut self, file: FileId, func: FnId) {
        self.prepare_parent(file, Parent::FnBody(func));
    }

    pub fn prepare_parent(&mut self, file: FileId, parent: Parent) {
        if let Some(func) = self.enclosing_fn(file, parent) {
            self.prepare_from_the_outside(file, func);
        }
    }

    /// The functions around `func` first. One that has been through here has them all behind it.
    fn prepare_from_the_outside(&mut self, file: FileId, func: FnId) {
        // One question after another is about the same function.
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
                            && self.p.calls.get(&(file, parent)).is_none()
                            && !self.stack.contains(&Query::Call(file, parent))
                        {
                            // The call may be an argument itself: outermost first.
                            self.prepare_context(file, parent);
                            self.resolve_call(file, parent);
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

    /// Works out what the component of the JSX element `e` takes, whatever encloses the element first.
    fn prepare_jsx(&mut self, file: FileId, e: ExprId) {
        if self.p.calls.get(&(file, e)).is_none() && !self.stack.contains(&Query::Call(file, e)) {
            self.prepare_context(file, e);
            self.jsx_props_type(file, e);
        }
    }

    /// What a pattern says of what it destructures: `[a, b]` wants a pair, `{ a }` something with an `a`.
    /// `None` for a plain name.
    pub(super) fn type_implied_by_pattern(&mut self, file: FileId, pat: PatId) -> Option<TypeId> {
        self.implied_by_pattern(file, pat, false)
    }

    /// The same as what the initializer of the pattern is expected to be. The names of the pattern that its own defaults
    /// mention are anything meanwhile: what they are depends on the initializer.
    pub(super) fn context_implied_by_pattern(
        &mut self,
        file: FileId,
        pat: PatId,
    ) -> Option<TypeId> {
        self.implied_by_pattern(file, pat, true)
    }

    fn implied_by_pattern(
        &mut self,
        file: FileId,
        pat: PatId,
        for_context: bool,
    ) -> Option<TypeId> {
        if !for_context
            || matches!(
                self.hir(file)[pat].kind,
                PatKind::Missing | PatKind::Ident(_)
            )
        {
            return self.implied_by_pattern_inner(file, pat, for_context);
        }
        self.contextual_binding_patterns
            .push((file, pat, self.stack.len()));
        let ty = self.implied_by_pattern_inner(file, pat, for_context);
        self.contextual_binding_patterns.pop();
        ty
    }

    /// Whether `e` names something bound by a pattern whose implied type is being worked out, from within that pattern.
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
        // `below`: the expression `at` is the parent of.
        let (mut at, mut below) = (bound.expr_parent[e.idx()], e);
        loop {
            let mut inner = match at {
                Parent::None | Parent::File => return false,
                Parent::PatPropDefault(p) => hir[p].value,
                Parent::PatElemDefault(p) => hir[p].pat,
                // A computed name in a pattern.
                Parent::PatKey(_) => match hir
                    .pat_props
                    .iter()
                    .find(|p| p.key == PropKey::Computed(below))
                {
                    Some(p) => p.value,
                    None => return false,
                },
                // One in an object literal.
                Parent::PropKey(owner, _) => {
                    at = Parent::Expr(owner);
                    continue;
                }
                _ => {
                    if let Parent::Expr(x) = at {
                        below = x;
                    }
                    at = self.parent_of(file, at);
                    continue;
                }
            };
            loop {
                match bound.pat_parent[inner.idx()] {
                    PatParent::Prop(outer, _) | PatParent::Elem(outer, _) => {
                        if outer == pattern {
                            // What is made of it holds for as long as the implied type is being worked out.
                            self.mark_tainted_from(floor.min(self.stack.len()));
                            self.cycles += 1;
                            return true;
                        }
                        inner = outer;
                    }
                    PatParent::Var(d) => {
                        at = Parent::VarInit(d);
                        break;
                    }
                    PatParent::Param(p) => {
                        at = Parent::ParamDefault(p);
                        break;
                    }
                    PatParent::None => return false,
                }
            }
            at = self.parent_of(file, at);
        }
    }

    /// `GetRootDeclaration`: the variable or the parameter that the pattern `pat` is part of belongs to.
    fn root_of_pattern(&self, file: FileId, mut pat: PatId) -> PatParent {
        loop {
            match self.bound(file).pat_parent[pat.idx()] {
                PatParent::Prop(parent, _) | PatParent::Elem(parent, _) => pat = parent,
                root => return root,
            }
        }
    }

    /// `getTypeFromBindingPattern`
    fn implied_by_pattern_inner(
        &mut self,
        file: FileId,
        pat: PatId,
        for_context: bool,
    ) -> Option<TypeId> {
        let hir = self.hir(file);
        // `getTypeFromBindingElement`
        let of_element = |c: &mut Self, pat: PatId, default: ExprId| -> TypeId {
            if default.is_some() {
                let implied = if for_context {
                    c.implied_by_pattern(file, pat, true)
                } else {
                    None
                };
                if let Some(implied) = implied {
                    c.contextual.push((file, default, implied));
                }
                let ty = c.type_of_expr(file, default);
                if implied.is_some() {
                    c.contextual.pop();
                }
                let root = c.root_of_pattern(file, pat);
                // `checkDeclarationInitializer`: below a parameter a default may as well have what its own pattern has defaults for.
                let ty = if matches!(root, PatParent::Param(_)) {
                    c.padded_for_pattern(file, pat, ty)
                } else {
                    ty
                };
                // `getWidenedLiteralTypeForInitializer`: below a constant a literal stays one.
                let is_constant = matches!(root, PatParent::Var(d) if matches!(hir[d].kind, VarKind::Const | VarKind::Using | VarKind::AwaitUsing));
                let ty = if is_constant { ty } else { c.widen_literal(ty) };
                // What is implied is widened as a whole where it becomes the type of something. What is expected is not.
                let ty = if for_context {
                    ty
                } else {
                    c.regular_object(ty)
                };
                return c.optional(ty);
            }
            c.implied_by_pattern(file, pat, for_context)
                .unwrap_or(TypeId::ANY)
        };
        match hir[pat].kind {
            PatKind::Missing | PatKind::Ident(_) => None,
            PatKind::Array(elems) => {
                let last_is_rest = elems.iter().last().is_some_and(|e| hir[e].is_rest);
                if elems.is_empty() || (elems.len() == 1 && last_is_rest) {
                    if self.p.files.options.target == crate::resolve::ScriptTarget::ES5 {
                        return Some(self.array_of(TypeId::ANY));
                    }
                    // `createIterableType`, `getGlobalIterableTypeChecked`
                    if self.global_type_symbol(known::Iterable).is_none() {
                        self.report_global_error(2318, vec!["Iterable".to_owned()]);
                    }
                    return Some(self.global_ref(
                        known::Iterable,
                        &[TypeId::ANY, TypeId::VOID, TypeId::UNDEFINED],
                    ));
                }
                let required = elems
                    .iter()
                    .enumerate()
                    .filter(|&(_, e)| {
                        !(hir[e].is_rest
                            || hir[e].default.is_some()
                            || matches!(hir[hir[e].pat].kind, PatKind::Missing))
                    })
                    .map(|(i, _)| i + 1)
                    .last()
                    .unwrap_or(0);
                let mut types = Vec::with_capacity(elems.len());
                let mut flags = Vec::with_capacity(elems.len());
                for (i, e) in elems.iter().enumerate() {
                    let elem = &hir[e];
                    types.push(if matches!(hir[elem.pat].kind, PatKind::Missing) {
                        TypeId::ANY
                    } else {
                        of_element(self, elem.pat, elem.default)
                    });
                    flags.push(if elem.is_rest {
                        ElemFlags::REST
                    } else if i >= required {
                        ElemFlags::OPTIONAL
                    } else {
                        ElemFlags::REQUIRED
                    });
                }
                Some(self.tuple(&types, &flags, false))
            }
            // `getTypeFromObjectBindingPattern`
            PatKind::Object(props) => {
                let mut shape = Shape::default();
                let mut has_computed_names = false;
                for p in props.iter() {
                    let prop = &hir[p];
                    if prop.is_rest {
                        shape
                            .index
                            .push(IndexInfo::new(TypeId::STRING, TypeId::ANY, false));
                        continue;
                    }
                    // A name that is only known when it runs is left out.
                    let Some(name) = self.member_name(file, prop.key) else {
                        has_computed_names = true;
                        continue;
                    };
                    let ty = of_element(self, prop.value, prop.default);
                    let flags = if prop.default.is_some() {
                        PropFlags::OPTIONAL
                    } else {
                        PropFlags::empty()
                    };
                    // Of two of one name the last counts.
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
                // `getNamedMembers`: what nothing declares comes in the order of the names.
                let atoms = &self.files().atoms;
                shape
                    .props
                    .sort_by(|a, b| atoms.bytes(a.name).cmp(atoms.bytes(b.name)));
                // `patternForType`
                if for_context {
                    shape.literal = if has_computed_names {
                        Literalness::PatternWithComputedNames
                    } else {
                        Literalness::Pattern
                    };
                }
                Some(self.synth(shape))
            }
        }
    }

    /// `patternForType`, as `checkObjectLiteral` asks it: whether `ty` was made from an object pattern as what its initializer is
    /// expected to be, or is the type of an object literal that is assigned to. `Some(true)`: from one with names that are only
    /// known when it runs (`ObjectFlagsObjectLiteralPatternWithComputedProperties`).
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
            } if self.is_assignment_target(file, e) => {
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

    /// Whether `ty` is such a type, or a tuple or a union with one in it.
    fn has_pattern_mark(&self, ty: TypeId) -> bool {
        match self.data(ty) {
            TypeData::Synth(shape) => matches!(
                shape.literal,
                Literalness::Pattern | Literalness::PatternWithComputedNames
            ),
            TypeData::Anon {
                origin: Origin::ObjectLiteral(file, e, ..),
                ..
            } => self.is_assignment_target(*file, *e),
            TypeData::Tuple { elems: parts, .. } | TypeData::Union(parts) => {
                parts.iter().any(|&p| self.has_pattern_mark(p))
            }
            _ => false,
        }
    }

    /// `getCovariantInference` ends in `getWidenedType`: what is inferred from what a pattern implies is a type like any other,
    /// which `patternForType` does not know.
    fn without_pattern_marks(&mut self, ty: TypeId) -> TypeId {
        if self.has_pattern_mark(ty) {
            self.regular_object(ty)
        } else {
            ty
        }
    }

    /// `patternForType[t] != nil`, of `t` which is expected of `e`.
    fn is_expected_by_pattern(&mut self, file: FileId, e: ExprId, t: TypeId) -> bool {
        if self.pattern_of_type(t).is_some() {
            return true;
        }
        // A tuple has no mark to go by. It was made from an array pattern if it is not what is expected regardless of patterns.
        if !self.is_tuple(t) || self.skip_binding_patterns > 0 {
            return false;
        }
        self.skip_binding_patterns += 1;
        let regardless = self.contextual_type(file, e);
        self.skip_binding_patterns -= 1;
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

    /// What `e` is expected to be. `None`: nothing in particular.
    pub fn contextual_type(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        self.guard("contextual_type");
        let hir = self.hir(file);
        // `getContextualType`: a node inside a `with` statement has no contextual type.
        if hir.is_in_with(hir[e].pos) {
            return None;
        }
        if let Some(&(_, _, ty)) = self
            .contextual
            .iter()
            .rev()
            .find(|c| c.0 == file && c.1 == e)
        {
            self.note_provisional_read();
            return Some(ty);
        }
        let ty = self.contextual_type_from_parent(file, e)?;
        let ty = self.force(ty);
        if ty == TypeId::UNRESOLVED {
            return None;
        }
        // What is expected of a call is only inferred from. That of a function written on the spot passes it on to its `return`s.
        if let ExprKind::Call(c) | ExprKind::New(c) | ExprKind::TaggedTemplate(c) = hir[e].kind
            && !matches!(hir[hir[c].callee].kind, ExprKind::Fn(_))
        {
            return Some(self.without_pattern_marks(ty));
        }
        Some(ty)
    }

    fn contextual_type_from_parent(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
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
                if self.skip_binding_patterns > 0 {
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
                    None if self.skip_binding_patterns > 0 => None,
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
                    let expected = self.contextual_type(file, class)?;
                    let name = self.member_name(file, hir[m].key)?;
                    return self.contextual_property(expected, name);
                }
                None
            }
            Parent::FnBody(f) => self.contextual_type_for_return_expression(file, e, f),
            Parent::Stmt(s) => match hir[s].kind {
                StmtKind::Return(_) => {
                    let f = self.enclosing_fn(file, Parent::Stmt(s))?;
                    self.contextual_type_for_return_expression(file, e, f)
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
                if let Some(known) = self.explicit_context(file, e) {
                    return Some(known);
                }
                let owner = bound.prop_owner[p.idx()];
                let prop = &hir[p];
                if let ExprKind::Jsx(_) = hir[owner].kind {
                    let props = self.jsx_props_type(file, owner)?;
                    if prop.kind == PropKind::Spread {
                        return Some(props);
                    }
                    let props = self.discriminate_by_jsx_attributes(file, owner, props);
                    let name = self.member_name(file, prop.key)?;
                    return self.contextual_property_of_value(file, e, props, name);
                }
                // What is spread is expected to be what the literal is, as that is put: a type parameter stays one.
                if prop.kind == PropKind::Spread {
                    return self.contextual_type(file, owner);
                }
                let context = self.contextual_type_for_object_literal(file, owner)?;
                match self.member_name(file, prop.key) {
                    Some(name) => self.contextual_property_of_value(file, e, context, name),
                    None => {
                        // `getLiteralTypeFromPropertyName`: the type of what is between the brackets.
                        let key = match prop.key {
                            PropKey::Computed(k) => {
                                let ty = self.type_of_expr(file, k);
                                self.regular(ty)
                            }
                            _ => TypeId::STRING,
                        };
                        self.contextual_index(
                            context,
                            if key == TypeId::UNRESOLVED {
                                TypeId::STRING
                            } else {
                                key
                            },
                        )
                    }
                }
            }
            Parent::Expr(parent) => self.contextual_type_in_expr(file, e, parent),
            // `getContextualTypeForDecorator`
            Parent::Decorator(_, owner) => {
                let sig = self.decorator_call_signature(file, owner)?;
                Some(self.synth(Shape {
                    call: vec![sig],
                    ..Shape::default()
                }))
            }
            Parent::PatPropDefault(p) => {
                self.contextual_type_for_default_of_element(file, hir[p].value)
            }
            Parent::PatElemDefault(p) => {
                self.contextual_type_for_default_of_element(file, hir[p].pat)
            }
            _ => None,
        }
    }

    /// `getContextualTypeForReturnExpression` for `e`, the expression body of `func` or the operand of one of its `return`
    /// statements. tsgo applies `instantiateContextualType` to `e` itself. Call resolution does that ahead of time and records the
    /// result, so a recorded context takes precedence.
    fn contextual_type_for_return_expression(
        &mut self,
        file: FileId,
        e: ExprId,
        func: FnId,
    ) -> Option<TypeId> {
        if let Some(recorded) = self.explicit_context(file, e) {
            return Some(recorded);
        }
        let expected = self.contextual_return_type(file, func);
        // Computing the context of `func` can resolve the enclosing call, which records the context of `e`.
        self.explicit_context(file, e).or(expected)
    }

    /// `getContextualTypeForInitializerExpression`, of the default of `pat`, an element of a pattern.
    fn contextual_type_for_default_of_element(
        &mut self,
        file: FileId,
        pat: PatId,
    ) -> Option<TypeId> {
        match self.contextual_type_for_binding_element(file, pat) {
            Some(ty) => Some(ty),
            None if self.skip_binding_patterns > 0 => None,
            None => self.type_implied_by_pattern_with_elements(file, pat),
        }
    }

    /// `getContextualTypeForBindingElement`: what the default of `pat`, an element of a pattern, stands in for.
    fn contextual_type_for_binding_element(&mut self, file: FileId, pat: PatId) -> Option<TypeId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (parent, place) = match bound.pat_parent[pat.idx()] {
            PatParent::Prop(parent, prop) if !hir[prop].is_rest => {
                // `IsComputedNonLiteralName`: a name that has to be worked out is not looked up.
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
                // A pattern in the place of a name says itself what it wants.
                if !matches!(hir[pat].kind, PatKind::Ident(_)) {
                    return None;
                }
                (parent, Err((elem.0 - elems.start) as usize))
            }
            _ => return None,
        };
        let parent_ty = match bound.pat_parent[parent.idx()] {
            PatParent::Var(d) if hir[d].ty.is_some() => self.type_from_node(file, hir[d].ty),
            PatParent::Var(d) if hir[d].init.is_some() => self.type_of_expr(file, hir[d].init),
            PatParent::Param(p) if hir[p].ty.is_some() => self.type_from_node(file, hir[p].ty),
            PatParent::Param(p) => {
                let func = bound.param_fn[p.idx()];
                match self.contextual_param_type(
                    file,
                    func,
                    (p.0 - hir[func].params.start) as usize,
                ) {
                    Some(ty) => ty,
                    // `checkDeclarationInitializer`, of the parameter. What that adds for the defaults in the pattern is left out:
                    // it says of a default what the default is.
                    None if hir[p].default.is_some() => self.type_of_expr(file, hir[p].default),
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

    /// `getTypeOfPropertyOfType`: the type of a property that is declared. An index signature does not stand in for one, except
    /// in a member of a union another member of which declares it.
    fn type_of_property_of_type(&mut self, ty: TypeId, name: Atom) -> Option<TypeId> {
        let ty = self.force(ty);
        let ty = self.reduced(ty);
        if !self.is_union(ty) {
            let apparent = self.apparent_type(ty);
            let members = self.members(apparent)?;
            let (prop, mapper) = self.property_in(&members, name)?;
            return Some(self.type_of_prop(prop, mapper));
        }
        let mut is_declared = false;
        for &part in self.parts(ty) {
            let apparent = self.apparent_type(part);
            if let Some(members) = self.members(apparent)
                && self.property_in(&members, name).is_some()
            {
                is_declared = true;
                break;
            }
        }
        if is_declared {
            self.type_of_property(ty, name)
        } else {
            None
        }
    }

    /// `contextual_property`, for the value `e` of the property. A literal or a function is asked about again for all that is
    /// written in it, so what is found for one is kept where it holds for good.
    fn contextual_property_of_value(
        &mut self,
        file: FileId,
        e: ExprId,
        context: TypeId,
        name: Atom,
    ) -> Option<TypeId> {
        if !matches!(
            self.hir(file)[e].kind,
            ExprKind::Object(_) | ExprKind::Array(_) | ExprKind::Fn(_)
        ) || !self.contextual_binding_patterns.is_empty()
        {
            return self.contextual_property(context, name);
        }
        if let Some(&found) = self.contextual_properties.get(&(context, name)) {
            return found;
        }
        let before = self.what_only_holds_for_now();
        let found = self.contextual_property(context, name);
        if self.holds_whenever_asked(before) {
            self.contextual_properties.insert((context, name), found);
        }
        found
    }

    /// `getTypeOfPropertyOfContextualType`: what each member of `context` says of the property `name`.
    pub(super) fn contextual_property(&mut self, context: TypeId, name: Atom) -> Option<TypeId> {
        let context = self.force(context);
        if self.is_any(context) {
            return None;
        }
        let mut types = Parts::new();
        for &written in self.parts(context) {
            // `getApparentTypeOfContextualType`: a mapped type stays as it is.
            let written = self.force(written);
            let part = if self.mapped_origin(written).is_some() {
                written
            } else {
                self.apparent_type(written)
            };
            if self.is_union(part) {
                if let Some(t) = self.contextual_property(part, name) {
                    types.push(t);
                }
                continue;
            }
            // `getApparentType`: in what a type parameter extends, `this` is the type parameter.
            let this = self.is_deferred(written).then_some(written);
            let found = if self.is_intersection(part) {
                self.contextual_property_of_intersection(part, this.unwrap_or(part), name)
            } else if !self.is_object_type(part) {
                None
            } else if self.is_generic_mapped_without_remapping(part) {
                self.contextual_property_of_generic_mapped(part, name)
            } else {
                match self.concrete_contextual_property(part, name, this) {
                    Some(declared) => Some(declared),
                    None => self.contextual_type_from_index_infos(part, name),
                }
            };
            if let Some(t) = found {
                types.push(self.force(t));
            }
        }
        if types.is_empty() {
            None
        } else {
            Some(self.union_unreduced(&types))
        }
    }

    /// The same of the intersection `whole`: what its members declare and, only if none does, what their index signatures say.
    /// `this`: what `this` is in its members.
    fn contextual_property_of_intersection(
        &mut self,
        whole: TypeId,
        this: TypeId,
        name: Atom,
    ) -> Option<TypeId> {
        let TypeData::Intersection(members) = self.data(whole) else {
            return None;
        };
        // `getApparentTypeOfIntersectionType`: every member as a property access sees it.
        let mut apparent = Parts::with_capacity(members.len());
        for &m in members.iter() {
            apparent.push(self.apparent_type(m));
        }
        if apparent
            .iter()
            .any(|&m| matches!(self.data(m), TypeData::Union(_) | TypeData::Intersection(_)))
        {
            // `(A | B) & C` is `A & C | B & C`.
            let distributed = self.intersection(&apparent);
            return if distributed == whole {
                None
            } else {
                self.contextual_property(distributed, name)
            };
        }
        // `appendContextualPropertyTypeConstituent`: `any` says nothing, and is not to drown what the others say.
        let program = self.p;
        let said = move |t: TypeId| {
            if program.has_any_flag(t) {
                TypeId::UNKNOWN
            } else {
                t
            }
        };
        let (mut found, mut candidates) = (Parts::new(), Parts::new());
        let mut ignore_index_infos = false;
        for &m in &apparent {
            if !self.is_object_type(m) {
                continue;
            }
            // A mapped type that does not know its keys yet has no say on index signatures.
            if self.is_generic_mapped_without_remapping(m) {
                found.extend(
                    self.contextual_property_of_generic_mapped(m, name)
                        .map(said),
                );
                continue;
            }
            match self.concrete_contextual_property(m, name, Some(this)) {
                Some(declared) => {
                    ignore_index_infos = true;
                    candidates.clear();
                    found.push(said(declared));
                }
                None if !ignore_index_infos => candidates.push(m),
                None => {}
            }
        }
        for m in candidates {
            found.extend(self.contextual_type_from_index_infos(m, name).map(said));
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
            // An `as` clause that gives back the key or nothing only leaves keys out.
            Some(renamed) => {
                let key = self.mapped_type_param(t);
                self.is_assignable(renamed, key)
            }
            None => true,
        }
    }

    /// `getIndexedMappedTypeSubstitutedTypeOfContextualType`: what a mapped type that does not know its keys yet makes of the
    /// key `name`.
    fn contextual_property_of_generic_mapped(&mut self, t: TypeId, name: Atom) -> Option<TypeId> {
        // A name that is a symbol stands for that symbol.
        let is_symbol = self.files().atoms.is_symbol_name(name);
        let key = if is_symbol {
            self.key_type_of_name(name)?
        } else {
            self.string_literal(name, false)
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
        // `undefined` stays in where the mapping makes properties optional.
        self.substitute_indexed_generic_mapped(t, key)
    }

    /// `isExcludedMappedPropertyName`: `K extends X ? never : K` stands for "not an `X`".
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

    /// `getTypeOfConcretePropertyOfContextualType`. `this`: what `this` is in the members of `part`, if not `part`.
    fn concrete_contextual_property(
        &mut self,
        part: TypeId,
        name: Atom,
        this: Option<TypeId>,
    ) -> Option<TypeId> {
        let members = self.members(part)?;
        let (prop, mut mapper) = self.property_in(&members, name)?;
        // `getTypeWithThisArgument`
        if let Some(this) = this
            && let TypeData::Ref { target, .. } = self.data(part)
        {
            let param = self.intern(TypeData::ThisParam(*target));
            let mapping = self.p.types.mapping(mapper);
            if mapping.iter().any(|pair| pair.0 == param && pair.1 != this) {
                let mut pairs = mapping.to_vec();
                for pair in &mut pairs {
                    if pair.0 == param {
                        pair.1 = this;
                    }
                }
                mapper = self.p.types.mapper(pairs);
            }
        }
        let ty = self.type_of_prop(prop, mapper);
        Some(self.remove_missing_type(ty, prop.flags.contains(PropFlags::OPTIONAL)))
    }

    /// `getTypeFromIndexInfosOfContextualType`
    fn contextual_type_from_index_infos(&mut self, part: TypeId, name: Atom) -> Option<TypeId> {
        // A place past the fixed start of a tuple is one of those the rest of it stands for.
        if let TypeData::Tuple { elems, flags, .. } = self.data(part)
            && self.is_numeric_name(name)
            && self
                .files()
                .atoms
                .text(name)
                .parse::<f64>()
                .is_ok_and(|n| n >= 0.0)
        {
            let fixed = flags
                .iter()
                .position(|f| f.intersects(ElemFlags::REST | ElemFlags::VARIADIC))
                .unwrap_or(flags.len());
            if let Some(rest) = self.tuple_slice_element(elems, flags, fixed, 0) {
                return Some(rest);
            }
        }
        let members = self.members(part)?;
        // A name that is a symbol goes by the signature for symbols.
        if self.files().atoms.is_symbol_name(name) {
            self.applicable_index_info(&members, TypeId::SYMBOL, None)
        } else {
            self.applicable_index_info(&members, TypeId::STRING, Some(name))
        }
    }

    /// `findApplicableIndexInfo`, member by member, for a name of which only the type `key` is known.
    fn contextual_index(&mut self, context: TypeId, key: TypeId) -> Option<TypeId> {
        let mut types = Vec::new();
        for &part in self.parts(context) {
            let part = self.apparent_type(part);
            let Some(members) = self.members(part) else {
                continue;
            };
            // The signature for strings counts only where no other does.
            let (mut for_strings, mut found) = (None, Vec::new());
            for info in &members.shape().index {
                if info.key == TypeId::STRING {
                    for_strings = Some(info.value);
                // `isApplicableIndexType`: a number signature also applies to `${number}`.
                } else if self.is_assignable(key, info.key)
                    || info.key == TypeId::NUMBER && self.is_numeric_string_type(key)
                {
                    found.push(info.value);
                }
            }
            // `isApplicableIndexType`: it takes numbers as well.
            if found.is_empty()
                && let Some(value) = for_strings
                && (self.is_assignable(key, TypeId::STRING)
                    || self.is_assignable(key, TypeId::NUMBER))
            {
                found.push(value);
            }
            for value in &mut found {
                *value = self.instantiate(*value, members.mapper);
            }
            match found[..] {
                [] => {}
                [only] => types.push(only),
                _ => types.push(self.intersection(&found)),
            }
        }
        if types.is_empty() {
            None
        } else {
            Some(self.union_unreduced(&types))
        }
    }

    /// `getApparentTypeOfContextualType` for an object literal: type variables are replaced by their constraints, and a union is
    /// narrowed to the members the literal can match.
    pub(super) fn contextual_type_for_object_literal(
        &mut self,
        file: FileId,
        literal: ExprId,
    ) -> Option<TypeId> {
        let context = self.contextual_type(file, literal)?;
        Some(self.apparent_context_of_object_literal(file, literal, context))
    }

    /// The same, of a literal that is expected to be `context`.
    pub(super) fn apparent_context_of_object_literal(
        &mut self,
        file: FileId,
        literal: ExprId,
        context: TypeId,
    ) -> TypeId {
        let context = self.map_type_unreduced(context, |c, m| {
            if c.is_deferred(m) {
                c.base_constraint(m)
            } else {
                m
            }
        });
        self.discriminate_by_object_members(file, literal, context)
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
        // While it is worked out what a pattern implies, its names are not what they are to anybody else.
        if !self.contextual_binding_patterns.is_empty() {
            return self.discriminate_by_members(file, props, context).0;
        }
        // It is asked for every member of the literal, and again for whatever is written in them.
        if let Some(&narrowed) = self.discriminated.get(&(file, literal, context)) {
            return narrowed;
        }
        let before = self.what_only_holds_for_now();
        let (narrowed, is_given_for_good) = self.discriminate_by_members(file, props, context);
        if is_given_for_good && self.holds_whenever_asked(before) {
            self.discriminated
                .insert((file, literal, context), narrowed);
        }
        narrowed
    }

    /// The same, of the members `props` of a literal and a `context` that is a union. Also whether all that the members are given
    /// as is kept, and primitive: what may have a generic signature is looked at again for the sake of a call that is being resolved.
    fn discriminate_by_members(
        &mut self,
        file: FileId,
        props: Span<PropId>,
        context: TypeId,
    ) -> (TypeId, bool) {
        let hir = self.hir(file);
        let context = self.with_apparent_primitives(context);
        if !self.is_union(context) {
            return (context, true);
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
                let given = self.context_free_discriminant_type(file, prop.value);
                is_given_for_good &= self.every_type(given, |c, t| c.is_primitive(t))
                    && self.p.expr_types.get(file, prop.value.idx()) == Some(given);
                items.push((name, given));
            }
        }
        self.push_left_out_discriminants(context, &written, &mut items);
        (
            self.discriminate_by_items(context, &items),
            is_given_for_good,
        )
    }

    /// Whether what has been made of types since `before`, which is what `what_only_holds_for_now` gave then, is what anybody is told
    /// who asks at any other time, with nothing raised or marked on the way.
    fn holds_whenever_asked(&self, before: (u64, u64)) -> bool {
        self.what_only_holds_for_now() == before
            // What goes by a call that is being resolved marks the questions asked since the call. If the call is the last of
            // them there is nothing to mark.
            && !self.is_innermost_tainted()
            && !matches!(self.stack.last(), Some(Query::Call(..)))
            // These are raised for whoever asked, each time.
            && !(self.uncertain
                || self.relation_gave_up
                || self.relation_too_complex
                || self.union_too_complex)
            && self.reliability == 0
            // What is under way is passed over in silence, or taken for what it is so far, by whoever comes upon it meanwhile.
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
                        | Query::Symbol(_)
                        | Query::Return(..)
                        | Query::ReturnAtFirstLook(..)
                        | Query::Member(..)
                )
            })
    }

    /// The mapping of `getApparentTypeOfContextualType`, of the primitives in `context`: a `string` is a `String`, with all that has.
    fn with_apparent_primitives(&mut self, context: TypeId) -> TypeId {
        self.map_type_unreduced(context, |c, m| {
            if !c.is_primitive(m) || c.is_nullish(m) {
                return m;
            }
            match c.apparent_type(m) {
                TypeId::UNRESOLVED => m,
                apparent => apparent,
            }
        })
    }

    /// `discriminateContextualTypeByJSXAttributes`: of the members of the union `props` that the attributes of `element` are
    /// expected to be, those they can be.
    pub(super) fn discriminate_by_jsx_attributes(
        &mut self,
        file: FileId,
        element: ExprId,
        props: TypeId,
    ) -> TypeId {
        let props = self.force(props);
        if !self.is_union(props) {
            return props;
        }
        let hir = self.hir(file);
        let ExprKind::Jsx(j) = hir[element].kind else {
            return props;
        };
        let context = self.with_apparent_primitives(props);
        if !self.is_union(context) {
            return context;
        }
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
                // An attribute that is only named is `true`.
                let given = if attr.value.is_none() {
                    TypeId::TRUE
                } else {
                    self.context_free_discriminant_type(file, attr.value)
                };
                items.push((name, given));
            }
        }
        // What is between the tags is given as well.
        if hir
            .ids(hir[j].children)
            .any(|child| !matches!(hir[child].kind, ExprKind::Missing))
            && let super::jsx::JsxName::Name(children) = self.jsx_children_property_name(file)
        {
            written.push(children);
        }
        self.push_left_out_discriminants(context, &written, &mut items);
        self.discriminate_by_items(context, &items)
    }

    /// `isPossiblyDiscriminantValue`: the kinds of expression that do not go by what is expected of them.
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

    /// `getContextFreeTypeOfExpression`, of such an expression. Whether a template stays a pattern does go by what is expected, which
    /// is what is being found out: it is what it comes to, or else a string.
    fn context_free_discriminant_type(&mut self, file: FileId, e: ExprId) -> TypeId {
        if !matches!(self.hir(file)[e].kind, ExprKind::Template { .. }) {
            return self.type_of_expr(file, e);
        }
        match self.constant_value(file, e) {
            Some(EnumValue::String(text)) => self.string_literal(text, true),
            _ => TypeId::STRING,
        }
    }

    /// The second half of the discriminators: a property of the union `context` that may be left out, tells its members apart and
    /// is not `written` is as good as `undefined`.
    fn push_left_out_discriminants(
        &mut self,
        context: TypeId,
        written: &[Atom],
        items: &mut Discriminants,
    ) {
        // `getPropertiesOfType`
        let reduced = self.reduced(context);
        let mut gone_through: SmallVec<[Members<'p>; 2]> = SmallVec::new();
        for &part in self.parts(reduced) {
            let Some(members) = self.members(part) else {
                break;
            };
            for prop in &members.shape().props {
                let name = prop.name;
                // Each name once.
                if gone_through
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
                // `createUnionOrIntersectionProperty`: it may be left out if it may in some member.
                let mut is_optional = false;
                for &m in self.parts(reduced) {
                    is_optional |= self
                        .prop_ref(m, name)
                        .is_some_and(|(p, _)| p.flags.contains(PropFlags::OPTIONAL));
                }
                // What some member has nothing for is no property of the union.
                if is_optional && self.type_of_property(reduced, name).is_some() {
                    items.push((name, TypeId::UNDEFINED));
                }
            }
            // `getPropertiesOfUnionOrIntersectionType`: what all members have, the first that has no index signatures has.
            if members.shape().index.is_empty() {
                break;
            }
            gone_through.push(members);
        }
    }

    /// `getTypeOfPropertyOrIndexSignatureOfType`
    fn discriminant_type_in(&mut self, ty: TypeId, name: Atom) -> Option<TypeId> {
        if let Some(declared) = self.type_of_property_of_type(ty, name) {
            return Some(declared);
        }
        let apparent = self.apparent_type(ty);
        let members = self.members(apparent)?;
        let value = self.applicable_index_type_for_name(&members, name)?;
        Some(self.optional_property(value))
    }

    /// `discriminateTypeByDiscriminableItems`. `items`: the names of properties, and what each is given as.
    fn discriminate_by_items(&mut self, context: TypeId, items: &[(Atom, TypeId)]) -> TypeId {
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
        for &(name, given) in items {
            // Those that do not match go only if some do: a discriminant that is wrong rules nothing out.
            let mut matched = false;
            for (i, &t) in types.iter().enumerate() {
                if include[i] == OUT {
                    continue;
                }
                let Some(wanted) = self.discriminant_type_in(t, name) else {
                    continue;
                };
                if given.is_never()
                    || self
                        .parts(given)
                        .iter()
                        .any(|&s| self.is_assignable(s, wanted))
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
    ) -> Option<TypeId> {
        let hir = self.hir(file);
        // `instantiateContextualType` with `ContextFlagsSignature` applies to a function wherever it is nested in an argument, so a
        // context that call resolution recorded for the function takes precedence. `contextual_type_of_arg` does this lookup for a
        // direct argument, after its checks for an immediately invoked function. A call nested in an argument of an overloaded call
        // stays resolved as it was for the first candidate (`resolvedSignature`): what that expected of it is recorded too.
        if matches!(
            hir[e].kind,
            ExprKind::Fn(_) | ExprKind::Call(_) | ExprKind::New(_)
        ) && !matches!(
            hir[parent].kind,
            ExprKind::Call(_) | ExprKind::New(_) | ExprKind::TaggedTemplate(_)
        ) && let Some(recorded) = self.explicit_context(file, e)
        {
            return Some(recorded);
        }
        match hir[parent].kind {
            ExprKind::Call(c) | ExprKind::New(c) | ExprKind::TaggedTemplate(c) => {
                if hir[c].callee == e || hir[c].template == e {
                    return None;
                }
                self.contextual_type_of_arg(file, parent, e)
            }
            // `getContextualTypeForYieldOperand`
            ExprKind::Yield { star: false, .. } => {
                let func = self.enclosing_fn_of_expr(file, parent)?;
                let declared = self.declared_or_contextual_return_type(file, func)?;
                let is_async = hir[func].flags.contains(Flags::ASYNC);
                let declared = self.alternatives_to_go_through(declared, is_async);
                self.iteration_types(declared, is_async).map(|t| t.yielded)
            }
            // Something to go through that yields what is to be yielded. Where nothing is said there is a hole, which nothing is
            // inferred from (`silentNeverType`).
            ExprKind::Yield { star: true, .. } => {
                let func = self.enclosing_fn_of_expr(file, parent)?;
                let declared = self.declared_or_contextual_return_type(file, func)?;
                let is_async = hir[func].flags.contains(Flags::ASYNC);
                let types = self.iteration_types(declared, is_async);
                let yielded = types.as_ref().map_or(TypeId::UNRESOLVED, |t| t.yielded);
                let next = types.as_ref().map_or(TypeId::UNKNOWN, |t| t.next);
                let returned = self
                    .contextual_type(file, parent)
                    .map_or(TypeId::UNRESOLVED, |t| self.without_pattern_marks(t));
                let generator = self.global_ref(known::Generator, &[yielded, returned, next]);
                if is_async {
                    let asynchronous =
                        self.global_ref(known::AsyncGenerator, &[yielded, returned, next]);
                    return Some(self.union(&[generator, asynchronous]));
                }
                Some(generator)
            }
            ExprKind::Array(items) => {
                if let Some(known) = self.explicit_context(file, e) {
                    return Some(known);
                }
                let context = self.contextual_type(file, parent)?;
                let index = hir.ids(items).position(|i| i == e)?;
                // `getSpreadIndices`
                let is_spread = |i: ExprId| matches!(hir[i].kind, ExprKind::Spread(_));
                let first = hir.ids(items).position(is_spread);
                let last = first.and_then(|_| hir.ids(items).rposition(is_spread));
                self.contextual_element_at(context, index, Some(items.len()), first, last)
            }
            // Nothing is expected of what is spread into an array or an argument list.
            ExprKind::Spread(_) => None,
            ExprKind::Cond { test, .. } => {
                if test == e {
                    return None;
                }
                self.contextual_type(file, parent)
            }
            // `getContextualTypeForBinaryOperand`
            ExprKind::Binary { op, left, right } => match op {
                // What a pattern implies says nothing to the right operand: the left one does.
                BinOp::Or | BinOp::Nullish => {
                    let context = self.contextual_type(file, parent);
                    if e == right
                        && context.is_none_or(|t| self.is_expected_by_pattern(file, parent, t))
                    {
                        return Some(self.type_of_expr(file, left));
                    }
                    context
                }
                BinOp::And | BinOp::Comma if e == right => self.contextual_type(file, parent),
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
                    return self.contextual_type(file, parent);
                }
                self.contextual_type_for_assignment(file, parent, target)
            }
            ExprKind::As { ty, .. } | ExprKind::Satisfies { ty, .. } => {
                Some(self.type_from_node(file, ty))
            }
            ExprKind::NonNull(_) | ExprKind::AsConst(_) => self.contextual_type(file, parent),
            // `getContextualTypeForAwaitOperand`
            ExprKind::Await(_) => {
                let context = self.contextual_type(file, parent)?;
                let context = self.without_pattern_marks(context);
                self.awaited_or_promise_like(context)
            }
            // `getContextualTypeForArgumentAtIndex`: of an `import()`, a string, an `ImportCallOptions`, and `any`.
            ExprKind::ImportCall { args, .. } => {
                if e == hir.id_at(args, 0) {
                    return Some(TypeId::STRING);
                }
                if hir.ids(args).nth(1) != Some(e) {
                    return Some(TypeId::ANY);
                }
                let name = self.files().atoms.lookup(b"ImportCallOptions")?;
                let sym = self.global_type_symbol(name)?;
                Some(self.declared_type(sym))
            }
            // `getContextualTypeForChildJsxExpression`
            ExprKind::Jsx(j) => {
                if let Some(known) = self.explicit_context(file, e) {
                    return Some(known);
                }
                // `GetSemanticJsxChildren`: `{}` is no child. Neither are the names in the tags.
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
                let props = self.jsx_props_type(file, parent)?;
                let props = self.discriminate_by_jsx_attributes(file, parent, props);
                let super::jsx::JsxName::Name(children) = self.jsx_children_property_name(file)
                else {
                    return None;
                };
                let field = self.contextual_property(props, children)?;
                if count == 1 {
                    return Some(field);
                }
                // Of several, each is expected to be what a list has in its place.
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

    /// `getContextualTypeForAssignmentExpression`: what is assigned is expected to be what the target is declared as, unless it is
    /// the assignment that declares it.
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
                    // Nothing is expected of what `module.exports = value` and `exports.a = value` export.
                    if self
                        .symbol_of_identifier(file, obj, name)
                        .is_some_and(|s| self.files().flags(s).contains(SymFlags::MODULE_EXPORTS))
                    {
                        return None;
                    }
                    if bound.is_expando_declaration(assignment) {
                        // A variable that says what it is says what its properties are expected to be.
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
                                        Some(name) => self.contextual_property(declared, name),
                                        None => Some(self.declared_type_of_reference(file, target)),
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
                // `this.x = value`, where `x` is declared without saying what it is: it is what is assigned to it.
                ExprKind::This => {
                    // In JavaScript the assignment may be what declares the property (`binary.Symbol != nil`): nothing is expected of it,
                    // unless the first declaration says what the property is (`binary.Symbol.ValueDeclaration.Type()`).
                    if let Some((class, is_static, declared)) = bound.this_property(hir, assignment)
                        && bound
                            .this_properties_of(class, is_static)
                            .iter()
                            .find(|x| x.2 == declared)
                            .is_none_or(|first| {
                                hir.jsdoc_type(JsDocTypeOwner::Assign(first.3)).is_none()
                            })
                    {
                        return None;
                    }
                    if self.declares_member_of_object_literal(file, assignment, obj) {
                        return None;
                    }
                    let this = self.type_of_expr(file, obj);
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
                        && let PropSource::Members(members) = &prop.source
                        && let Some(&(of, m)) = members.first()
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
        let written_property = match hir[target].kind {
            // `checkIdentifier`: what cannot be assigned to is of no type where that is tried.
            ExprKind::Ident(name) => {
                if let Some(sym) = self.symbol_of_identifier(file, target, name) {
                    let flags = self.files().flags(sym);
                    if !flags.intersects(SymFlags::VARIABLE) || flags.contains(SymFlags::CONST) {
                        return None;
                    }
                }
                None
            }
            ExprKind::Dot { obj, name, .. } => Some((obj, name)),
            ExprKind::Index { obj, index, .. } => {
                let key = self.type_of_expr(file, index);
                self.property_name_of_type(key).map(|name| (obj, name))
            }
            // A pattern is read as the literal it looks like, made of what its targets are declared as.
            ExprKind::Array(_) | ExprKind::Object(_) => {
                return Some(self.type_of_expr(file, target));
            }
            _ => None,
        };
        // `isAssignmentToReadonlyEntity`: neither is a property that can only be read.
        if let Some((obj, name)) = written_property {
            let mut said = Vec::new();
            self.check_property_write(file, target, obj, name, 0, &mut said);
            if !said.is_empty() {
                return None;
            }
        }
        Some(self.declared_type_of_reference(file, target))
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

    /// `getContextualTypeForElementExpression`. `length`: how many elements are written, if that is known. `first_spread`,
    /// `last_spread`: where the first and the last `...` among them are.
    pub(super) fn contextual_element_at(
        &mut self,
        context: TypeId,
        index: usize,
        length: Option<usize>,
        first_spread: Option<usize>,
        last_spread: Option<usize>,
    ) -> Option<TypeId> {
        let variable = ElemFlags::REST | ElemFlags::VARIADIC;
        let before_spreads = first_spread.is_none_or(|s| index < s);
        let mut types = Parts::new();
        for &part in self.parts(context) {
            // `getApparentTypeOfContextualType`: a mapped type stays as it is.
            let part = self.force(part);
            let part = if self.mapped_origin(part).is_some() {
                part
            } else {
                self.apparent_type(part)
            };
            if self.is_union(part) {
                if let Some(t) =
                    self.contextual_element_at(part, index, length, first_spread, last_spread)
                {
                    types.push(t);
                }
                continue;
            }
            // What anything yields when it is gone through is anything.
            if self.has_any_flag(part) {
                types.push(part);
                continue;
            }
            if let TypeData::Tuple { elems, flags, .. } = self.data(part) {
                let fixed = flags
                    .iter()
                    .position(|f| f.intersects(variable))
                    .unwrap_or(flags.len());
                if before_spreads && index < fixed {
                    let element = self.force(elems[index]);
                    // What may be left out holds `undefined` too, whether or not that is kept with the element.
                    let is_optional = flags[index].contains(ElemFlags::OPTIONAL);
                    let element = if is_optional {
                        self.optional_property(element)
                    } else {
                        element
                    };
                    types.push(self.remove_missing_type(element, is_optional));
                    continue;
                }
                // How far from the end the element is, if that can be told, and how much of the end of the tuple is fixed.
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
                    types.push(self.force(elems[elems.len() - offset]));
                    continue;
                }
                let from = first_spread.map_or(fixed, |s| fixed.min(s));
                let end_skip = match (length, last_spread) {
                    (Some(n), Some(s)) => fixed_end.min(n.saturating_sub(s)),
                    _ => fixed_end,
                };
                if let Some(t) = self.tuple_slice_element(elems, flags, from, end_skip) {
                    types.push(t);
                }
                continue;
            }
            if let Some(element) = self.array_element(part) {
                types.push(self.force(element));
                continue;
            }
            // `getTypeOfPropertyOfContextualType(t, index)`: a property of that name, or the index signature that takes it.
            if before_spreads {
                let name = self.number_name(index as f64);
                if let Some(t) = self.contextual_property(part, name) {
                    types.push(t);
                    continue;
                }
            }
            // `getIteratedTypeOrElementType(IterationUseElement, t, .., nil)`: what cannot be gone through says nothing.
            let part = self.apparent_type(part);
            if let Some((method, mapper)) = self.prop_ref(part, known::sym_iterator)
                && !method.flags.contains(PropFlags::OPTIONAL)
            {
                let method = self.type_of_prop(method, mapper);
                if self.has_any_flag(method) {
                    types.push(method);
                } else if !self.signatures(method, false).is_empty() {
                    let element = self.iterated_type(part, false);
                    if element != TypeId::UNRESOLVED {
                        types.push(self.force(element));
                    }
                }
            }
        }
        if types.is_empty() {
            None
        } else {
            Some(self.union_unreduced(&types))
        }
    }

    /// `getElementTypeOfSliceOfTupleType`, to read, with nothing reduced: what the elements from `from` on, but for the last
    /// `end_skip`, may be.
    fn tuple_slice_element(
        &mut self,
        elems: &[TypeId],
        flags: &[ElemFlags],
        from: usize,
        end_skip: usize,
    ) -> Option<TypeId> {
        let end = elems.len().saturating_sub(end_skip);
        if from >= end {
            return None;
        }
        let mut slice = Parts::with_capacity(end - from);
        for i in from..end {
            let element = if flags[i].contains(ElemFlags::VARIADIC) {
                self.indexed_access(elems[i], TypeId::NUMBER)
            } else {
                self.force(elems[i])
            };
            slice.push(if flags[i].contains(ElemFlags::OPTIONAL) {
                self.optional_property(element)
            } else {
                element
            });
        }
        Some(self.union_unreduced(&slice))
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
        let context = self.contextual_type(file, owner)?;
        self.contextual_signature_in(file, func, context)
    }

    /// The same, of a function expression that is expected to be a `context`.
    pub(super) fn contextual_signature_in(
        &mut self,
        file: FileId,
        func: FnId,
        context: TypeId,
    ) -> Option<SigId> {
        // `getApparentType`: a type parameter is what it extends, in an intersection too.
        let context = self.map_type_unreduced(context, |c, m| {
            if c.is_deferred(m) || matches!(c.data(m), TypeData::Intersection(_)) {
                c.base_constraint(m)
            } else {
                m
            }
        });
        let required = self.required_own_params(file, func);
        let mut found: SmallVec<[SigId; 4]> = SmallVec::new();
        // The members that can have a signature, in the order of `sorted_parts`.
        let mut parts: Parts = self
            .parts(context)
            .iter()
            .copied()
            .filter(|&part| !self.is_primitive(part))
            .collect();
        if parts.len() > 1 {
            parts.sort_by(|&a, &b| self.compare_types(a, b));
        }
        for part in parts {
            // `getContextualCallSignature`
            let mut fitting: SmallVec<[SigId; 4]> = SmallVec::new();
            for s in self.signatures(part, false) {
                if !self.is_arity_smaller(file, func, s, required) {
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
            // The members of a union have to agree on everything but `this` and what they return.
            if let Some(&first) = found.first()
                && !self.compare_signatures_identical(first, sig, false, true, true)
            {
                // What could not be found out is not known to differ.
                let mut is_known = true;
                for s in [first, sig] {
                    is_known &= self.sig_params(s).iter().all(|p| self.is_known(p.ty));
                }
                if is_known {
                    return None;
                }
            }
            found.push(sig);
        }
        match found[..] {
            [] => None,
            [only] => Some(only),
            [first, ..] if found.iter().all(|&s| s == first) => Some(first),
            // `createUnionSignature`: the first, returning what any of them returns.
            [first, ..] => {
                let (type_params, params, this) = (
                    self.sig_type_params(first),
                    self.sig_params(first),
                    self.sig_this_type(first),
                );
                // The return type of a composite signature is resolved on demand, and nobody asks while that of a member is being
                // resolved (`isResolvingReturnTypeOfSignature`).
                if found
                    .iter()
                    .any(|&s| self.is_resolving_return_type(s) || self.is_at_first_look(s))
                {
                    return Some(self.p.types.intern_sig(SigData::Synth {
                        type_params: type_params.into(),
                        params: params.into(),
                        ret: TypeId::UNRESOLVED,
                        this,
                        of: found.into_boxed_slice(),
                    }));
                }
                let returns: Parts = found.iter().map(|&s| self.sig_return(s)).collect();
                let ret = self.union_reduced(&returns);
                Some(self.p.types.intern_sig(SigData::Synth {
                    type_params: type_params.into(),
                    params: params.into(),
                    ret,
                    this,
                    of: Box::new([]),
                }))
            }
        }
    }

    /// `getContextualCallSignature`: the call signature of `ty` that `func` can have, going by how many parameters it requires.
    pub(super) fn contextual_call_signature(
        &mut self,
        file: FileId,
        func: FnId,
        ty: TypeId,
    ) -> Option<SigId> {
        let required = self.required_own_params(file, func);
        let mut fitting: SmallVec<[SigId; 4]> = SmallVec::new();
        for s in self.signatures(ty, false) {
            if !self.is_arity_smaller(file, func, s, required) {
                fitting.push(s);
            }
        }
        match fitting[..] {
            [] => None,
            [only] => Some(only),
            _ => self.intersected_signature(&fitting),
        }
    }

    /// `assignContextualParameterTypes`: a context-sensitive function without type parameters adopts those of a generic contextual
    /// signature (`sig.typeParameters = context.typeParameters`). Returns `sig` unchanged if it adopts nothing.
    pub(super) fn with_adopted_type_params(&mut self, sig: SigId) -> SigId {
        let SigData::Decl { mapper, .. } = *self.p.types.sig(sig) else {
            return sig;
        };
        // Only the signature as declared qualifies: its mapper may map the type parameters in scope to themselves. The copy
        // stores the return type, so none is made while that type is being resolved.
        if self
            .p
            .types
            .mapping(mapper)
            .iter()
            .any(|&(from, to)| from != to)
            || self.is_resolving_return_type(sig)
        {
            return sig;
        }
        let adopted = self.adopted_type_params(sig);
        // `SigData::Synth` cannot hold a type predicate.
        if adopted.is_empty() || self.sig_predicate(sig).is_some() {
            return sig;
        }
        let (params, ret, this) = (
            self.sig_params(sig),
            self.sig_return(sig),
            self.sig_this_type(sig),
        );
        self.p.types.intern_sig(SigData::Synth {
            type_params: adopted.into(),
            params: params.into(),
            ret,
            this,
            of: Box::new([]),
        })
    }

    /// `assignContextualParameterTypes`: whether a function around `e` has taken `param` over from the generic signature expected of
    /// it. What is written in that function may mean `param`, which is declared elsewhere. The same if `param` has reached the type of
    /// one of its parameters: `inferTypeArguments` instantiates a generic contextual signature of a call with its own type parameters
    /// (`getSignatureInstantiationWithoutFillingInTypeArguments`), which are then inferred for what a function argument takes.
    pub(super) fn is_type_param_adopted_around(
        &mut self,
        file: FileId,
        e: ExprId,
        param: TypeId,
    ) -> bool {
        let mut around = self.enclosing_fn_of_expr(file, e);
        while let Some(func) = around {
            if self.hir(file)[func].type_params.is_empty()
                && let Some(owner) = self.takes_context(file, func)
                && self.is_context_sensitive(file, owner)
                && let Some(expected) = self.contextual_signature(file, func)
                && (self.sig_type_params(expected).contains(&param)
                    || self.has_contextual_parameter_type_mentioning(file, func, param))
            {
                return true;
            }
            let enclosing = self.bound(file).fns[func.idx()].enclosing;
            around = enclosing.is_some().then_some(enclosing);
        }
        false
    }

    /// Whether a parameter of `func` without a type annotation gets a contextual type that mentions `param`.
    fn has_contextual_parameter_type_mentioning(
        &mut self,
        file: FileId,
        func: FnId,
        param: TypeId,
    ) -> bool {
        let hir = self.hir(file);
        for (index, p) in hir[func].params.iter().enumerate() {
            if hir[p].ty.is_none()
                && let Some(ty) = self.contextual_param_type(file, func, index)
                && self.mentions(ty, param)
            {
                return true;
            }
        }
        false
    }

    /// `getIntersectedSignatures`: one signature for a function that is to be all of `sigs`.
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

    /// The `targetParameterCount` of `isAritySmaller`: the parameters of `func` before the first that may be left out.
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

    /// `isAritySmaller`: `sig`, which `func` is expected to be, takes fewer arguments than `func` has parameters (`required`), and so
    /// is not meant.
    fn is_arity_smaller(&mut self, file: FileId, func: FnId, sig: SigId, required: usize) -> bool {
        let params = self.sig_params(sig);
        if self.has_effective_rest_parameter(&params) || self.parameter_count(&params) >= required {
            return false;
        }
        // It is asked of the signature as the callee declares it: `...args: U` takes any number.
        !self
            .open_contextual_signature(file, func)
            .is_some_and(|open| {
                let params = self.sig_params(open);
                self.has_effective_rest_parameter(&params)
            })
    }

    /// What `func` is expected to be as the callee declares it.
    pub(super) fn open_contextual_signature(&mut self, file: FileId, func: FnId) -> Option<SigId> {
        let owner = self.takes_context(file, func)?;
        let context = self.open_contextual_type(file, owner)?;
        let context = self.non_nullable(context);
        self.single_call_signature(context, false)
    }

    /// What `e`, an argument of a call whose type arguments are inferred, or a property of an object literal that is one, is expected
    /// to be as the callee declares it, its type parameters still in it: `inferTypeArguments` looks at an argument with that pushed
    /// for what is expected of it.
    fn open_contextual_type(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let call = match bound.expr_parent[e.idx()] {
            Parent::Expr(call) => call,
            Parent::Prop(p) => {
                let literal = bound.prop_owner[p.idx()];
                if literal.is_none()
                    || !matches!(hir[literal].kind, ExprKind::Object(_))
                    || hir[p].kind == PropKind::Spread
                {
                    return None;
                }
                let context = self.open_contextual_type(file, literal)?;
                let name = self.member_name(file, hir[p].key)?;
                return self.contextual_property(context, name);
            }
            _ => return None,
        };
        let (ExprKind::Call(c) | ExprKind::New(c)) = hir[call].kind else {
            return None;
        };
        if !self.type_arguments_of_call(file, call).is_empty() {
            return None;
        }
        let index = hir.ids(hir[c].args).position(|a| a == e)?;
        if hir
            .ids(hir[c].args)
            .take(index)
            .any(|a| matches!(hir[a].kind, ExprKind::Spread(_)))
        {
            return None;
        }
        let under_consideration = self
            .resolving
            .iter()
            .rev()
            .find(|r| r.file == file && r.call == call)
            .map(|r| r.params.clone());
        let params = match under_consideration {
            Some(params) => params,
            // The signature that was picked, without what was filled in for its own type parameters.
            None => {
                let picked = self.p.calls.get(&(file, call))?.sig?;
                let SigData::Decl {
                    file: of,
                    func: declared,
                    mapper,
                } = *self.p.types.sig(picked)
                else {
                    return None;
                };
                let own: Vec<TypeId> = self.hir(of)[declared]
                    .type_params
                    .iter()
                    .map(|tp| self.type_param(of, tp))
                    .collect();
                if own.is_empty() {
                    return None;
                }
                let around: Vec<(TypeId, TypeId)> = self
                    .p
                    .types
                    .mapping(mapper)
                    .iter()
                    .copied()
                    .filter(|pair| !own.contains(&pair.0))
                    .collect();
                let mapper = self.p.types.mapper(around);
                let open = self.p.types.intern_sig(SigData::Decl {
                    file: of,
                    func: declared,
                    mapper,
                });
                self.sig_params(open)
            }
        };
        self.param_type_at(&params, index)
    }

    /// `getContextualType` of `e`, (part of) an argument of a call in `resolving`, derived from the parameter type that call has
    /// there: during inference the declared one, which `checkExpressionWithContextualType` pushes and no mapper is applied to. Also
    /// returns the index of the call in `resolving`. `None`: there is no such call, or the way up to it is not covered.
    pub(super) fn pushed_contextual_type(
        &mut self,
        file: FileId,
        e: ExprId,
    ) -> Option<(TypeId, usize)> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        match bound.expr_parent[e.idx()] {
            Parent::Expr(parent) => match hir[parent].kind {
                ExprKind::Call(c) | ExprKind::New(c) => {
                    let args = hir[c].args;
                    if hir
                        .ids(args)
                        .any(|a| matches!(hir[a].kind, ExprKind::Spread(_)))
                    {
                        return None;
                    }
                    let index = hir.ids(args).position(|a| a == e)?;
                    let outer = self
                        .resolving
                        .iter()
                        .rposition(|r| r.file == file && r.call == parent)?;
                    let params = self.resolving[outer].params.clone();
                    let param = self.context_of_arg_at(&params, index, Some(args.len()))?;
                    Some((param, outer))
                }
                ExprKind::Cond { test, .. } if test != e => {
                    self.pushed_contextual_type(file, parent)
                }
                ExprKind::Binary {
                    op: BinOp::Or | BinOp::Nullish,
                    ..
                }
                | ExprKind::NonNull(_) => self.pushed_contextual_type(file, parent),
                ExprKind::Binary {
                    op: BinOp::And | BinOp::Comma,
                    right,
                    ..
                } if right == e => self.pushed_contextual_type(file, parent),
                // `getContextualTypeForElementExpression`
                ExprKind::Array(items) => {
                    let (context, outer) = self.pushed_contextual_type(file, parent)?;
                    let context = self.force(context);
                    if !self.is_object_type(context) {
                        return None;
                    }
                    let index = hir.ids(items).position(|i| i == e)?;
                    let is_spread = |i: ExprId| matches!(hir[i].kind, ExprKind::Spread(_));
                    let first = hir.ids(items).position(is_spread);
                    let last = first.and_then(|_| hir.ids(items).rposition(is_spread));
                    let element =
                        self.contextual_element_at(context, index, Some(items.len()), first, last)?;
                    Some((element, outer))
                }
                _ => None,
            },
            // `getContextualTypeForObjectLiteralElement`
            Parent::Prop(p) => {
                let literal = bound.prop_owner[p.idx()];
                if literal.is_none()
                    || !matches!(hir[literal].kind, ExprKind::Object(_))
                    || !matches!(hir[p].kind, PropKind::Init | PropKind::Method)
                {
                    return None;
                }
                let (context, outer) = self.pushed_contextual_type(file, literal)?;
                let context = self.force(context);
                if !self.is_object_type(context) {
                    return None;
                }
                let name = self.member_name(file, hir[p].key)?;
                let member = self.contextual_property(context, name)?;
                Some((member, outer))
            }
            // `getContextualReturnType`
            parent @ (Parent::FnBody(_) | Parent::Stmt(_)) => {
                if let Parent::Stmt(s) = parent
                    && (s.is_none() || !matches!(hir[s].kind, StmtKind::Return(_)))
                {
                    return None;
                }
                let func = self.enclosing_fn(file, parent)?;
                let function = self.takes_context(file, func)?;
                if hir[func].ret.is_some()
                    || hir[func].flags.intersects(Flags::ASYNC | Flags::GENERATOR)
                {
                    return None;
                }
                let (context, outer) = self.pushed_contextual_type(file, function)?;
                let sig = self.contextual_signature_in(file, func, context)?;
                if self.is_resolving_return_type(sig) || self.is_at_first_look(sig) {
                    return None;
                }
                Some((self.sig_return(sig), outer))
            }
            _ => None,
        }
    }

    /// `getContextualType` of `e` with nothing pushed: what is expected of an argument, and of all that is part of one, comes from the
    /// parameter type of the resolved signature (`getContextualTypeForArgumentAtIndex`). `arg_contexts` keeps what was pushed while
    /// the call was resolved. A call that is not resolved, or is being resolved, expects nothing.
    pub(super) fn contextual_type_from_resolved_signature(
        &mut self,
        file: FileId,
        e: ExprId,
    ) -> Option<TypeId> {
        let outer = std::mem::replace(&mut self.pulls_contextual_types_at, self.stack.len());
        let context = self.contextual_type(file, e);
        self.pulls_contextual_types_at = outer;
        context
    }

    /// Whether `sig` is the signature `func` declares, not an instantiation of it.
    pub(super) fn is_signature_of_declaration(&self, sig: SigId, file: FileId, func: FnId) -> bool {
        matches!(
            *self.p.types.sig(sig),
            SigData::Decl { file: f, func: g, mapper }
                if f == file
                    && g == func
                    && self.p.types.mapping(mapper).iter().all(|&(from, to)| from == to)
        )
    }

    /// `contextualSignature == c.getSignatureFromDeclaration(fn)`: a type argument of the call around was inferred as the type of
    /// `func`, so the resolved signature expects the signature `func` declares. With another signature in what was pushed, the
    /// return type was resolved under that one when the function was first checked.
    pub(super) fn is_own_contextual_signature(&mut self, file: FileId, func: FnId) -> bool {
        let Some(function) = self.takes_context(file, func) else {
            return false;
        };
        if self
            .contextual_signature(file, func)
            .is_some_and(|pushed| !self.is_signature_of_declaration(pushed, file, func))
        {
            return false;
        }
        self.contextual_type_from_resolved_signature(file, function)
            .and_then(|context| self.contextual_signature_in(file, func, context))
            .is_some_and(|sig| self.is_signature_of_declaration(sig, file, func))
    }

    /// The type parameter `index` of `func` gets from where the function is used.
    pub fn contextual_param_type(
        &mut self,
        file: FileId,
        func: FnId,
        index: usize,
    ) -> Option<TypeId> {
        // `isContextSensitiveFunctionOrObjectLiteralMethod`: a function with type parameters of its own takes nothing from where it is.
        if !self.hir(file)[func].type_params.is_empty() {
            return None;
        }
        if let Some(given) = self.iife_param_type(file, func, index) {
            return given;
        }
        let sig = self.contextual_signature(file, func)?;
        let params = self.sig_params(sig);
        let hir = self.hir(file);
        let own = hir[func].params.at(index);
        if hir[own].flags.contains(Flags::REST) {
            let rest = self.params_as_tuple(&params, index);
            // `[...T[]]` is `T[]`.
            if let TypeData::Tuple { elems, flags, .. } = self.data(rest)
                && let ([e], [f]) = (&**elems, &**flags)
                && f.contains(ElemFlags::REST)
            {
                return Some(self.array_of(*e));
            }
            return Some(rest);
        }
        // `tryGetTypeAtPosition`: past the end of a rest tuple that ends there is nothing. `assignParameterType` then asks
        // `getContextuallyTypedParameterType`, which sees the signature as the callee declares it: of `...args: U`, `U[index]`.
        if index >= self.parameter_count(&params) && !self.has_effective_rest_parameter(&params) {
            let open = self.open_contextual_signature(file, func)?;
            let open = self.sig_params(open);
            return if self.has_effective_rest_parameter(&open) {
                self.param_type_at(&open, index)
            } else {
                None
            };
        }
        let ty = self.param_type_at(&params, index)?;
        Some(self.force(ty))
    }

    /// `getContextualReturnType`: what `func` says it returns, or is expected to return, as a whole.
    pub(super) fn declared_or_contextual_return_type(
        &mut self,
        file: FileId,
        func: FnId,
    ) -> Option<TypeId> {
        let f = &self.hir(file)[func];
        // `getReturnTypeFromAnnotation`: a constructor is to return an instance of its class.
        if f.kind == FnKind::Constructor
            && let FnOwner::Member(m) = self.bound(file).fns[func.idx()].owner
            && let crate::bind::MemberOwner::Class(class) = self.bound(file).member_owner[m.idx()]
        {
            let sym = self.class_sym(file, class);
            return Some(self.declared_type(sym));
        }
        if f.ret.is_some() {
            return Some(self.type_from_node(file, f.ret));
        }
        // A getter is to return what the setter that goes with it is written to take.
        if f.kind == FnKind::Getter
            && let Some(taken) = self.annotated_setter_type(file, func)
        {
            return Some(taken);
        }
        if let Some(returned) = self.return_type_of_full_signature(file, func) {
            return Some(returned);
        }
        // What is expected of a function may be the function itself, where a type argument was inferred from it. At its first look
        // TypeScript then works out what it returns once more, this time with that under way, and keeps the answer.
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
            // Of the alternatives, those that what such a function gives can be. If there is only one, that or nothing.
            let expected = self.force(expected);
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
                // `checkGeneratorInstantiationAssignabilityToReturnType`
                let types = c.iteration_types(t, is_async);
                let yielded = types.as_ref().map_or(TypeId::ANY, |i| i.yielded);
                let returned = types.as_ref().map_or(yielded, |i| i.returned);
                let next = types.as_ref().map_or(TypeId::UNKNOWN, |i| i.next);
                let generator = c.global_ref(
                    if is_async {
                        known::AsyncGenerator
                    } else {
                        known::Generator
                    },
                    &[yielded, returned, next],
                );
                c.is_assignable(generator, t)
            });
            return Some(fitting);
        }
        // Of a function called where it is written, what is expected of the call.
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
        self.contextual_type(file, call)
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

    /// Whether `sig` is of a function that is being looked at for the first time: see `Query::ReturnAtFirstLook`.
    fn is_at_first_look(&self, sig: SigId) -> bool {
        match *self.p.types.sig(sig) {
            SigData::Decl { file, func, .. } => {
                self.p.fn_return_types.get(file, func.idx()).is_none()
                    && self.stack.contains(&Query::ReturnAtFirstLook(file, func))
            }
            SigData::Synth { ref of, .. } => of.iter().any(|&s| self.is_at_first_look(s)),
            _ => false,
        }
    }

    /// `isResolvingReturnTypeOfSignature`
    pub(super) fn is_resolving_return_type(&self, sig: SigId) -> bool {
        match *self.p.types.sig(sig) {
            SigData::Decl { file, func, .. } => {
                self.p.fn_return_types.get(file, func.idx()).is_none()
                    && self.stack.contains(&Query::Return(file, func))
            }
            SigData::Synth { ref of, .. } => of.iter().any(|&s| self.is_resolving_return_type(s)),
            _ => false,
        }
    }

    /// `getContextualTypeForReturnExpression`, `getContextualTypeForYieldOperand`: of the alternatives a generator is to return,
    /// those that can be gone through.
    fn alternatives_to_go_through(&mut self, declared: TypeId, is_async: bool) -> TypeId {
        if self.is_union(declared) {
            self.filter(declared, |c, t| c.iteration_types(t, is_async).is_some())
        } else {
            declared
        }
    }

    /// What the `return`s of `func` are expected to give.
    pub fn contextual_return_type(&mut self, file: FileId, func: FnId) -> Option<TypeId> {
        let f = &self.hir(file)[func];
        // `getTypeFromTypeNode`, of a type predicate.
        if f.ret.is_some()
            && let TypeNodeKind::Predicate { asserts, .. } = self.hir(file)[f.ret].kind
        {
            return Some(if asserts {
                TypeId::VOID
            } else {
                TypeId::BOOLEAN
            });
        }
        let mut declared = self.declared_or_contextual_return_type(file, func)?;
        if f.flags.contains(Flags::GENERATOR) {
            // What it returns in the end is what the one who iterates is told last.
            let is_async = f.flags.contains(Flags::ASYNC);
            declared = self.alternatives_to_go_through(declared, is_async);
            declared = self.iteration_types(declared, is_async)?.returned;
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
        let promise = self.global_ref(known::PromiseLike, &[awaited]);
        Some(self.union(&[awaited, promise]))
    }
}

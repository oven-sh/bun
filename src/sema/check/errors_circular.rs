//! Circularity errors: 2313 2615, and 2502 2577 7022 7023 7024.
//!
//! In TypeScript 7.0.2's checker.go these result from `pushTypeResolution` finding the requested
//! resolution already in progress, in `getBaseConstructorTypeOfClass`, `getBaseTypes` and
//! `getResolvedBaseConstraint`: every entry from there to the top of the stack is in the cycle, and
//! an entry that only leads to it is not. Here the cycles are detected in the syntax, and among
//! those that `Checker::enter` found when the types were requested.

use super::explain::NOWHERE;
use super::sink::held;
use super::*;
use crate::bind::{Decl, FnOwner, MemberOwner, Parent, PatParent, Symbol, SymbolId};
use smallvec::SmallVec;

type TypeParams = SmallVec<[TypeParamId; 8]>;

/// Whether `eagerly_resolved_mapped_keys` can find anything in `node`, regardless of the type
/// argument counts of the names in it.
fn contains_mapped_type_node(hir: &hir::File, node: TypeNodeId) -> bool {
    if node.is_none() {
        return false;
    }
    match hir[node].kind {
        TypeNodeKind::Mapped(_) => true,
        TypeNodeKind::Array(t)
        | TypeNodeKind::Keyof(t)
        | TypeNodeKind::Readonly(t)
        | TypeNodeKind::JSDoc { ty: t, .. } => contains_mapped_type_node(hir, t),
        TypeNodeKind::Tuple(elems) => elems
            .iter()
            .any(|e| contains_mapped_type_node(hir, hir[e].ty)),
        TypeNodeKind::Ref { args: list, .. }
        | TypeNodeKind::Union(list)
        | TypeNodeKind::Intersection(list)
        | TypeNodeKind::Template { types: list, .. }
        | TypeNodeKind::Typeof { args: list, .. } => {
            hir.ids(list).any(|t| contains_mapped_type_node(hir, t))
        }
        TypeNodeKind::IndexedAccess { obj, index } => {
            contains_mapped_type_node(hir, obj) || contains_mapped_type_node(hir, index)
        }
        TypeNodeKind::Cond { check, extends, .. } => {
            contains_mapped_type_node(hir, check) || contains_mapped_type_node(hir, extends)
        }
        _ => false,
    }
}

/// `getUnionType`, `getIntersectionType`: the keyword that determines the type at `node` regardless
/// of its other members. In a union `any`, and then `unknown`, absorbs the rest. In an intersection
/// `never`, and then `any`.
fn absorbing_keyword(hir: &hir::File, node: TypeNodeId) -> Option<Keyword> {
    let strongest = |members: IdList<TypeNodeId>, first: Keyword, second: Keyword| {
        let mut found = None;
        for member in hir.ids(members) {
            match absorbing_keyword(hir, member) {
                Some(keyword) if keyword == first => return Some(first),
                Some(keyword) if keyword == second => found = Some(second),
                _ => {}
            }
        }
        found
    };
    match hir[node].kind {
        TypeNodeKind::Keyword(keyword @ (Keyword::Any | Keyword::Unknown | Keyword::Never)) => {
            Some(keyword)
        }
        TypeNodeKind::Union(members) => strongest(members, Keyword::Any, Keyword::Unknown),
        TypeNodeKind::Intersection(members) => strongest(members, Keyword::Never, Keyword::Any),
        _ => None,
    }
}

impl Checker<'_, '_> {
    pub(super) fn check_circularities(&mut self, file: FileId) {
        self.check_circular_resolutions(file);
        let (hir, bound) = (self.hir(file), self.bound(file));
        let unchecked = self.unchecked_jsdoc_types(file);
        // `checkClassLikeDeclaration`, `checkInterfaceDeclaration`
        for c in 0..hir.classes.len() {
            if bound.class_symbol[c].is_some() {
                let own = self.class_sym(file, ClassId(c as u32));
                self.base_constructor_type_of_class(own);
                self.base_types(own);
            }
        }
        for &symbol in bound.interface_symbol.iter().filter(|s| s.is_some()) {
            let own = self.files().sym(file, symbol);
            self.base_types(own);
        }
        self.check_circular_mapped_properties();
        for p in 0..hir.type_params.len() {
            let constraint = hir.type_params[p].constraint;
            if constraint.is_none()
                || bound.type_param_scope[p].is_none()
                || unchecked.contain(hir[constraint].pos)
            {
                continue;
            }
            let own = TypeParamId(p as u32);
            let mut is_circular = self.is_constraint_circular(file, own);
            // `checkTypeParameter`: the base constraint is requested, which detects the cycles that
            // are not visible in the syntax: through the target of a type alias, through `T[K]`,
            // through a conditional type.
            if !is_circular && bound.type_param_symbol[p].is_some() {
                let param = self.type_param(file, own);
                is_circular = self
                    .constraint_from_type_param(param)
                    .is_some_and(|extended| self.has_circular_base_constraint(param, extended));
                is_circular = is_circular || !self.has_non_circular_base_constraint(param);
            }
            if is_circular {
                let start = start_of_type(hir, constraint);
                let end = self.end_of_type_node_from(file, constraint, start);
                let name = self.atom_text(hir.type_params[p].name);
                let related = self.origin_of_circular_constraint(file, own, start, end);
                self.error_at((file, start, end), 2313, &[Arg::Bytes(&name)])
                    .related_information
                    .extend(related);
            }
        }
    }

    /// `getResolvedBaseConstraint`: 2313 for the key of the mapped type at `mapped`, which had to
    /// be resolved to decide whether `extending` can extend the type. `c.currentNode` is
    /// `extending`, which is being checked.
    pub(super) fn report_circular_mapped_key(
        &mut self,
        file: FileId,
        mapped: TypeNodeId,
        extending: (FileId, Decl),
    ) {
        let hir = self.hir(file);
        let TypeNodeKind::Mapped(m) = hir[mapped].kind else {
            return;
        };
        let param = &hir[hir[m].param];
        // `GetDiagnostics` reads the diagnostics of a file once it has checked the file, in program
        // order. Diagnostics that the check of a later file adds to it are never read.
        let files = self.files();
        let order = |f: FileId| (!files.module(f).is_lib, files.rank_of_file(f));
        if param.constraint.is_none() || order(extending.0) > order(file) {
            return;
        }
        let start = start_of_type(hir, param.constraint);
        let end = self.end_of_type_node_from(file, param.constraint, start);
        let mut err = self.new_diagnostic((file, start, end), 2313, &[Arg::Atom(param.name)]);
        if let (of, Decl::Interface(i)) = extending {
            // `isNodeDescendantOf`
            let is_written_in_it = of == file
                && (hir[hir[i].stmt].start..self.end_of_stmt(file, hir[i].stmt))
                    .contains(&hir[mapped].pos);
            if !is_written_in_it {
                let at = self.place_of_token(of, self.hir(of)[i].name_pos);
                let origin = self.new_diagnostic(at, 2751, &[]);
                err.add_related_info(origin);
            }
        }
        self.add_diagnostic(err);
    }

    /// Requests the types for which `reportCircularityError`, `getReturnTypeOfSignature` and
    /// `getTypeOfAccessors` report cycles.
    fn check_circular_resolutions(&mut self, file: FileId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let unchecked = self.unchecked_jsdoc_types(file);
        for i in 0..hir.pats.len() {
            let pat = PatId(i as u32);
            if !matches!(hir[pat].kind, PatKind::Ident(_))
                || matches!(bound.pat_parent[i], PatParent::None)
                || unchecked.contain(hir[pat].pos)
            {
                continue;
            }
            self.type_of_pat(file, pat);
            // `parameterInitializerContainsUndefined` is evaluated where the parameter is read: in
            // its own default, that is circular.
            if let PatParent::Param(p) = bound.pat_parent[i]
                && hir[p].ty.is_some()
                && hir[p].default.is_some()
            {
                self.type_of_expr(file, hir[p].default);
            }
        }
        for i in 0..hir.members.len() {
            let member = MemberId(i as u32);
            if !matches!(
                hir[member].kind,
                MemberKind::Property | MemberKind::Getter | MemberKind::Setter
            ) || matches!(bound.member_owner[i], MemberOwner::None)
                || unchecked.contain(hir[member].start)
            {
                continue;
            }
            // `getTypeOfSymbol`: the properties and accessors among the declarations of one symbol
            // are one property, identified by the first.
            let is_first = bound.member_symbol[i].is_some() && {
                let sym = self.symbol_of_member(file, member);
                self.files().value_declaration(sym) == Some((file, Decl::Member(member)))
            };
            if is_first || hir[member].kind == MemberKind::Property {
                self.type_of_member_declaration(file, member);
            }
        }
        for i in 0..hir.fns.len() {
            let func = FnId(i as u32);
            if matches!(bound.fns[i].owner, FnOwner::None) || unchecked.contain(hir[func].start) {
                continue;
            }
            // An annotated accessor of a class, an interface or a type literal was already
            // requested above, with the property it declares.
            let is_member = matches!(hir[func].kind, FnKind::Getter | FnKind::Setter)
                && !(hir[func].kind == FnKind::Getter
                    && matches!(bound.fns[i].owner, FnOwner::Expr(_)));
            if hir[func].ret.is_some() && !is_member
                || hir[func].ret.is_none() && !matches!(hir[func].body, FnBody::None)
            {
                self.return_type_of_fn(file, func);
            }
        }
        self.check_circular_exports(file);
        self.check_circular_assignment_declarations(file);
    }

    /// The end of `getTypeOfAccessors`, where `popTypeResolution` finds the cycle. `members`: the declarations of the property `sym`.
    pub(super) fn report_circular_accessors(&mut self, sym: Sym, members: &[(FileId, MemberId)]) {
        let of_kind = |c: &Self, kind: MemberKind| {
            members
                .iter()
                .copied()
                .find(|&(file, m)| c.hir(file)[m].kind == kind)
        };
        let (getter, setter) = (
            of_kind(self, MemberKind::Getter),
            of_kind(self, MemberKind::Setter),
        );
        // `getAnnotatedAccessorTypeNode`
        let annotated_getter = getter.filter(|&(file, g)| {
            let hir = self.hir(file);
            hir[hir[g].func].ret.is_some()
        });
        let annotated_setter = setter.filter(|&(file, s)| {
            let hir = self.hir(file);
            let first = hir[hir[s].func].params.iter().next();
            first.is_some_and(|p| hir[p].ty.is_some())
        });
        let auto_accessor = of_kind(self, MemberKind::Property);
        // `symbolToString`
        let (file, first) = members[0];
        let end = self.end_of_member_name(file, first);
        let name = self.source_text(file, self.hir(file)[first].name_pos, end);
        let ((file, accessor), code) = match (annotated_getter, annotated_setter) {
            (Some(getter), _) => (getter, 2502),
            (None, Some(setter)) => (setter, 2502),
            // It is reported on the set accessor, which is nil.
            _ if auto_accessor.is_some_and(|(file, m)| self.hir(file)[m].ty.is_some()) => {
                let err = Reported::new(NOWHERE, 2502, held(vec![name]));
                return self.add_diagnostic_of(Some(Query::Symbol(sym)), err);
            }
            _ => match getter {
                Some(getter) if self.p.files.options.no_implicit_any => (getter, 7023),
                _ => return,
            },
        };
        let at = (
            file,
            self.hir(file)[accessor].name_pos,
            self.end_of_member_name(file, accessor),
        );
        let err = self.new_diagnostic(at, code, &[Arg::Bytes(&name)]);
        self.add_diagnostic_of(Some(Query::Symbol(sym)), err);
    }

    /// `symbol.ValueDeclaration` of the CommonJS export `symbol`: the assignment. `None` if it is
    /// not an assignment.
    pub(super) fn commonjs_value_declaration(&self, symbol: &Symbol) -> Option<ExprId> {
        match *symbol.decls.get(symbol.value_declaration as usize)? {
            Decl::ModuleExports(assignment) | Decl::ExportsProperty(assignment) => Some(assignment),
            _ => None,
        }
    }

    /// `checkExportAssignment`, `checkBinaryLikeExpression`: the types of `export default e`,
    /// `export = e`, `module.exports = e` and `exports.a = e` are requested.
    fn check_circular_exports(&mut self, file: FileId) {
        for (i, symbol) in self.bound(file).symbols.iter().enumerate() {
            if symbol
                .flags
                .intersects(SymFlags::VARIABLE | SymFlags::PROPERTY)
                && matches!(
                    symbol.decls.first(),
                    Some(Decl::ExportExpr(_) | Decl::ModuleExports(_) | Decl::ExportsProperty(_))
                )
            {
                let sym = self.files().sym(file, SymbolId(i as u32));
                self.type_of_symbol(sym);
            }
        }
    }

    /// `checkPropertyAccessExpression` resolves the type of a property declared by `f.a = e` or `this.a = e` when it checks the left
    /// side. `Object.defineProperty(f, "a", descriptor)` resolves it only if the descriptor reads the property.
    fn check_circular_assignment_declarations(&mut self, file: FileId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if !hir.is_js {
            return;
        }
        let this_properties =
            (bound.symbols.iter().flat_map(|symbol| &symbol.decls)).filter_map(|decl| match decl {
                Decl::ThisProperty(e) => Some(e),
                _ => None,
            });
        for &declaration in bound.expando_declarations.iter().chain(this_properties) {
            let checked = match hir[declaration].kind {
                ExprKind::Assign { target, .. } => target,
                _ => declaration,
            };
            self.type_of_expr(file, checked);
        }
    }

    /// `getTypeOfMappedSymbol`: 2615 at `c.currentNode`, the type node being checked when the type of a property of a mapped type
    /// turns out to depend on itself. For the cycles that this task has found since the last call, in whatever file the node is.
    /// A task that hits the entry of the property has nothing to report.
    pub(super) fn check_circular_mapped_properties(&mut self) {
        let mut found = std::mem::take(&mut self.circular_mapped_props);
        // The first cycle found at a node names the property.
        found.sort_by_key(|&(node, ..)| node);
        found.dedup_by_key(|&mut (node, ..)| node);
        for ((file, node), mapped, name) in found {
            // A variable of that type that is read during emit creates the type first.
            let created = self.type_from_node(file, node);
            // Under any alias: the keys of the mapped type, which lead into the cycle, are the same.
            let created = self.intern(self.data(created).clone_in(self.arena));
            let variable = if matches!(self.data(created), TypeData::Anon { .. }) {
                self.first_variable_read_by_emit(file, |c, ty| {
                    c.intern(c.data(ty).clone_in(self.arena)) == created
                })
            } else {
                None
            };
            let (start, end) = match variable {
                Some(at) => (at, self.end_of_token_at(file, at)),
                None => (self.hir(file)[node].pos, self.end_of_type_node(file, node)),
            };
            let args = vec![
                match self.prop_ref(mapped, name) {
                    Some((prop, _)) => self.prop_to_string(prop),
                    None => self.atom_text(name),
                },
                self.type_to_string(mapped),
            ];
            let err = Reported::new((file, start, end), 2615, held(args));
            self.add_diagnostic_of(Some(Query::MappedProp(mapped, name)), err);
        }
    }

    /// `getNameOfDeclaration`: the position of the name of `func`: its own or, for an anonymous
    /// function expression, the name it is assigned to (`GetAssignedName`).
    fn name_of_function(&self, file: FileId, func: FnId) -> Option<u32> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let e = match bound.fns[func.idx()].owner {
            FnOwner::Member(m) => return Some(hir[m].name_pos),
            _ if hir[func].name.is_some() => return Some(hir[func].name_pos),
            FnOwner::Expr(e) => e,
            _ => return None,
        };
        match bound.expr_parent[e.idx()] {
            // A method or an accessor of an object literal, with a computed name.
            Parent::Prop(p)
                if matches!(
                    hir[p].kind,
                    PropKind::Method | PropKind::Getter | PropKind::Setter
                ) =>
            {
                Some(hir[p].pos)
            }
            _ => bound.get_assigned_name(hir, e),
        }
    }

    /// The end of `getReturnTypeOfSignature`, where `popTypeResolution` finds the cycle: 2577, 7023
    /// at the name of the function, 7024 at a function without a name. For a getter of an object
    /// literal it is the end of `getTypeOfAccessors`. `owner`: see `add_diagnostic_of`.
    pub(super) fn report_circular_return_type(
        &mut self,
        owner: Option<Query>,
        file: FileId,
        func: FnId,
    ) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let no_implicit_any = self.p.files.options.no_implicit_any;
        let fn_owner = bound.fns[func.idx()].owner;
        let named = |c: &mut Self, of: FnId, code: u32| {
            if let Some(start) = c.name_of_function(file, of) {
                let end = c.end_of_name_at(file, start);
                let name = c.source_text(file, start, end);
                let err = c.new_diagnostic((file, start, end), code, &[Arg::Bytes(&name)]);
                c.add_diagnostic_of(owner, err);
                return true;
            }
            false
        };
        if matches!(hir[func].kind, FnKind::Getter | FnKind::Setter) {
            // The accessors of classes, interfaces and type literals are reported with the property
            // they declare.
            if hir[func].kind == FnKind::Getter && matches!(fn_owner, FnOwner::Expr(_)) {
                let setter = self
                    .sibling_accessor(file, func, FnKind::Setter)
                    .filter(|&s| {
                        let first = hir[s].params.iter().next();
                        first.is_some_and(|p| hir[p].ty.is_some())
                    });
                match setter {
                    _ if hir[func].ret.is_some() => named(self, func, 2502),
                    Some(setter) => named(self, setter, 2502),
                    None => no_implicit_any && named(self, func, 7023),
                };
            }
        } else if hir[func].ret.is_some() {
            let ret = hir[func].ret;
            let at = (file, hir[ret].pos, self.end_of_type_node(file, ret));
            let err = self.new_diagnostic(at, 2577, &[]);
            self.add_diagnostic_of(owner, err);
        } else if no_implicit_any
            && !matches!(hir[func].body, FnBody::None)
            && !named(self, func, 7023)
        {
            let (start, end) = self.error_range_of_fn(file, func);
            let err = self.new_diagnostic((file, start, end), 7024, &[]);
            self.add_diagnostic_of(owner, err);
        }
    }

    /// A file is emitted before it is checked: `markPropertyAliasReferenced` resolves the type of
    /// the `a` of every `a.b`, then `GetConstantValue` that of every `a.b` and `a[b]`. Returns the
    /// position of the first `a`, in that order, that is an identifier and whose type satisfies
    /// `is_it`.
    fn first_variable_read_by_emit(
        &mut self,
        file: FileId,
        mut is_it: impl FnMut(&mut Self, TypeId) -> bool,
    ) -> Option<u32> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let options = &self.p.files.options;
        if options.no_emit || options.isolated_modules || hir.kind == FileKind::Declaration {
            return None;
        }
        let index = self.exprs_by_kind(file);
        // Whether it is only visited in the second pass, and its position.
        let mut first: Option<(bool, u32)> = None;
        for (tag, is_second) in [(ExprTag::Dot, hir.is_js), (ExprTag::Index, true)] {
            for &e in index.of(tag) {
                let (ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. }) = hir[e].kind else {
                    continue;
                };
                let at = (is_second, hir[obj].pos);
                if !matches!(hir[obj].kind, ExprKind::Ident(_))
                    || bound.is_unchecked(e.idx())
                    || bound.is_in_type_query(e)
                    || first.is_some_and(|first| first <= at)
                {
                    continue;
                }
                let ty = self.type_of_expr(file, obj);
                if is_it(self, ty) {
                    first = Some(at);
                }
            }
        }
        first.map(|first| first.1)
    }

    /// `getResolvedBaseConstraint`: `c.currentNode` when the cycle that contains the type parameter
    /// `own` is first detected, unless that node is inside the constraint of `own`, which spans
    /// `start` to `end`, or encloses it.
    fn origin_of_circular_constraint(
        &mut self,
        file: FileId,
        own: TypeParamId,
        start: u32,
        end: u32,
    ) -> Vec<Reported> {
        // `getNarrowableTypeForReference` requests the constraint of the type of a variable.
        let variable = self.first_variable_read_by_emit(file, |c, ty| {
            matches!(
                *c.data(ty),
                TypeData::TypeParam(of, declared, around)
                    if of == file
                        && around == MapperId::IDENTITY
                        && c.constraint_leads_to(file, declared, own)
            )
        });
        let at = match variable {
            Some(at) => Some(self.place_of_token(file, at)),
            None => self
                .first_reference_resolving_mapped_key(file, own)
                .map(|node| {
                    let from = self.hir(file)[node].pos;
                    (file, from, self.end_of_type_node(file, node))
                })
                .filter(|&(_, from, to)| {
                    !(start..end).contains(&from) && !(from..to).contains(&start)
                }),
        };
        at.map(|at| Reported::bare(at, 2751)).into_iter().collect()
    }

    /// Whether `from` is `to`, or its constraint leads to it, based on the syntax as in
    /// `is_constraint_circular`.
    fn constraint_leads_to(&self, file: FileId, from: TypeParamId, to: TypeParamId) -> bool {
        let hir = self.hir(file);
        let (mut seen, mut todo) = (TypeParams::new(), TypeParams::new());
        todo.push(from);
        while let Some(next) = todo.pop() {
            if next == to {
                return true;
            }
            if !seen.contains(&next) {
                seen.push(next);
                if hir[next].constraint.is_some() {
                    self.type_parameters_of_constraint(file, hir[next].constraint, &mut todo);
                }
            }
        }
        false
    }

    /// `getTypeFromMappedTypeNode` resolves the constraint of its key eagerly when the type is
    /// created. For `own`, the key of a mapped type inside a type alias, that is when the first
    /// type reference that leads to the alias is checked. Children have lower ids and are checked
    /// first.
    fn first_reference_resolving_mapped_key(
        &self,
        file: FileId,
        own: TypeParamId,
    ) -> Option<TypeNodeId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if !hir.mapped.iter().any(|m| m.param == own) {
            return None;
        }
        let written = hir[hir[own].constraint].pos;
        let around = hir.aliases.iter().position(|alias| {
            alias.ty.is_some()
                && (hir[alias.ty].pos..self.end_of_type_node(file, alias.ty)).contains(&written)
        })?;
        if bound.alias_symbol[around].is_none() {
            return None;
        }
        let alias = self.files().sym(file, bound.alias_symbol[around]);
        (0..hir.types.len() as u32).map(TypeNodeId).find(|&node| {
            self.alias_referred_to(file, node)
                .is_some_and(|named| self.alias_leads_to(named, alias, &mut Vec::new()))
        })
    }

    /// The type alias the type reference `node` names.
    fn alias_referred_to(&self, file: FileId, node: TypeNodeId) -> Option<Sym> {
        let (hir, files) = (self.hir(file), self.files());
        let scope = self.bound(file).type_scope[node.idx()];
        let TypeNodeKind::Ref { name, .. } = hir[node].kind else {
            return None;
        };
        if scope.is_none() {
            return None;
        }
        let names: SmallVec<[Atom; 4]> = hir.texts(name).collect();
        let named = files
            .resolve_entity(file, scope, &names, SymFlags::TYPE)
            .and_then(|s| files.resolve_alias_as(s, SymFlags::TYPE))?;
        files
            .flags(named)
            .contains(SymFlags::TYPE_ALIAS)
            .then_some(named)
    }

    /// Whether creating the type aliased by `from` creates the type aliased by `to`.
    fn alias_leads_to(&self, from: Sym, to: Sym, seen: &mut Vec<Sym>) -> bool {
        if from == to {
            return true;
        }
        if seen.contains(&from) {
            return false;
        }
        seen.push(from);
        let mut named = Vec::new();
        for &(file, decl) in self.files().decls_of(from).iter() {
            if let Decl::Alias(a) = decl {
                self.eagerly_resolved_aliases(file, self.hir(file)[a].ty, &mut named);
            }
        }
        named
            .into_iter()
            .any(|next| self.alias_leads_to(next, to, seen))
    }

    /// The type aliases referenced in the parts that are resolved eagerly when the type at `node`
    /// is created, as in `eagerly_resolved_mapped_keys`: for a mapped type the constraint of its
    /// key.
    fn eagerly_resolved_aliases(&self, file: FileId, node: TypeNodeId, into: &mut Vec<Sym>) {
        if node.is_none() {
            return;
        }
        let hir = self.hir(file);
        match hir[node].kind {
            TypeNodeKind::Mapped(m) => {
                self.eagerly_resolved_aliases(file, hir[hir[m].param].constraint, into)
            }
            TypeNodeKind::Array(t)
            | TypeNodeKind::Keyof(t)
            | TypeNodeKind::Readonly(t)
            | TypeNodeKind::JSDoc { ty: t, .. } => self.eagerly_resolved_aliases(file, t, into),
            TypeNodeKind::Tuple(elems) => {
                for e in elems.iter() {
                    self.eagerly_resolved_aliases(file, hir[e].ty, into);
                }
            }
            TypeNodeKind::Ref { args, .. } => {
                into.extend(self.alias_referred_to(file, node));
                for t in hir.ids(args) {
                    self.eagerly_resolved_aliases(file, t, into);
                }
            }
            TypeNodeKind::Union(list)
            | TypeNodeKind::Intersection(list)
            | TypeNodeKind::Template { types: list, .. } => {
                for t in hir.ids(list) {
                    self.eagerly_resolved_aliases(file, t, into);
                }
            }
            TypeNodeKind::IndexedAccess { obj, index } => {
                self.eagerly_resolved_aliases(file, obj, into);
                self.eagerly_resolved_aliases(file, index, into);
            }
            TypeNodeKind::Cond { check, extends, .. } => {
                self.eagerly_resolved_aliases(file, check, into);
                self.eagerly_resolved_aliases(file, extends, into);
            }
            _ => {}
        }
    }

    /// `hasNonCircularBaseConstraint`, negated and based on the syntax: whether the constraint of
    /// the type parameter `own` leads back to it, through the type parameters
    /// `type_parameters_of_constraint` finds in each constraint. One that only leads to a cycle is
    /// not in it.
    pub(super) fn is_constraint_circular(&self, file: FileId, own: TypeParamId) -> bool {
        let constraint = self.hir(file)[own].constraint;
        if constraint.is_none() {
            return false;
        }
        let mut mentioned = TypeParams::new();
        self.type_parameters_of_constraint(file, constraint, &mut mentioned);
        (mentioned.iter()).any(|&from| self.constraint_leads_to(file, from, own))
    }

    /// The type parameters a constraint reduces to: itself, the members of a union or an
    /// intersection, and the keys of the mapped types that are created with it.
    fn type_parameters_of_constraint(&self, file: FileId, node: TypeNodeId, into: &mut TypeParams) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        match hir[node].kind {
            TypeNodeKind::Ref { name, args } if args.is_empty() && name.len() == 1 => {
                let found = self.files().resolve_name(
                    file,
                    bound.type_scope[node.idx()],
                    hir[name.at(0)].text,
                    SymFlags::TYPE,
                );
                if let Some(found) = found
                    && found.file == file
                    && let Some(&Decl::TypeParam(p)) = self.files().symbol(found).decls.first()
                {
                    into.push(p);
                }
            }
            // `computeBaseConstraint` uses the type: `T | unknown` and `T & never` no longer
            // contain `T`.
            TypeNodeKind::Union(types) | TypeNodeKind::Intersection(types)
                if absorbing_keyword(hir, node).is_none() =>
            {
                for t in hir.ids(types) {
                    self.type_parameters_of_constraint(file, t, into);
                }
            }
            _ => self.eagerly_resolved_mapped_keys(file, node, into),
        }
    }

    /// `getTypeFromMappedTypeNode` resolves the constraint of its key eagerly when the type is
    /// created: the keys of the mapped types that are created together with `node`, which is in a
    /// constraint, where nothing is deferred (`isDeferredTypeReferenceNode`). Members, signatures,
    /// the templates of mapped types and their name types are resolved lazily.
    fn eagerly_resolved_mapped_keys(&self, file: FileId, node: TypeNodeId, into: &mut TypeParams) {
        if node.is_none() {
            return;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        match hir[node].kind {
            TypeNodeKind::Mapped(m) => into.push(hir[m].param),
            TypeNodeKind::Array(t)
            | TypeNodeKind::Keyof(t)
            | TypeNodeKind::Readonly(t)
            | TypeNodeKind::JSDoc { ty: t, .. } => self.eagerly_resolved_mapped_keys(file, t, into),
            TypeNodeKind::Tuple(elems) => {
                for e in elems.iter() {
                    self.eagerly_resolved_mapped_keys(file, hir[e].ty, into);
                }
            }
            TypeNodeKind::Ref { name, args } => {
                if !hir.ids(args).any(|t| contains_mapped_type_node(hir, t)) {
                    return;
                }
                // `getTypeFromClassOrInterfaceReference`, `getTypeFromTypeAliasReference`: a wrong
                // number of type arguments is an error, and they are not resolved. Those of an
                // unresolved name are.
                let files = self.files();
                let names: SmallVec<[Atom; 4]> = hir.texts(name).collect();
                let named = files
                    .resolve_entity(file, bound.type_scope[node.idx()], &names, SymFlags::TYPE)
                    .and_then(|s| files.resolve_alias_as(s, SymFlags::TYPE));
                if let Some(named) = named {
                    let (least, most) = self.type_argument_arity(named);
                    if !(least..=most).contains(&args.len()) {
                        return;
                    }
                }
                for t in hir.ids(args) {
                    self.eagerly_resolved_mapped_keys(file, t, into);
                }
            }
            TypeNodeKind::Union(list)
            | TypeNodeKind::Intersection(list)
            | TypeNodeKind::Template { types: list, .. }
            | TypeNodeKind::Typeof { args: list, .. } => {
                for t in hir.ids(list) {
                    self.eagerly_resolved_mapped_keys(file, t, into);
                }
            }
            TypeNodeKind::IndexedAccess { obj, index } => {
                self.eagerly_resolved_mapped_keys(file, obj, into);
                self.eagerly_resolved_mapped_keys(file, index, into);
            }
            // Which branch is taken, if any, cannot be determined from the syntax.
            TypeNodeKind::Cond { check, extends, .. } => {
                self.eagerly_resolved_mapped_keys(file, check, into);
                self.eagerly_resolved_mapped_keys(file, extends, into);
            }
            _ => {}
        }
    }
}

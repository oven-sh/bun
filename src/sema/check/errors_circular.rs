//! Circularity errors: 2313, and 2502 2577 7022 7023 7024.
//!
//! In TypeScript 7.0.2's checker.go these result from `pushTypeResolution` finding the requested
//! resolution already in progress, in `getBaseConstructorTypeOfClass`, `getBaseTypes` and
//! `getResolvedBaseConstraint`: every entry from there to the top of the stack is in the cycle, and
//! an entry that only leads to it is not. Here they are the cycles that `Checker::enter` found when
//! the types were requested.

use super::explain::NOWHERE;
use super::sink::held;
use super::*;
use crate::bind::{Decl, FnOwner, MemberOwner, Parent, PatParent, Symbol, SymbolId};

impl Checker<'_, '_> {
    pub(super) fn check_circularities(&mut self, file: FileId) {
        self.check_circular_resolutions(file);
        let (hir, bound) = (self.hir(file), self.bound(file));
        let unchecked = self.unchecked_jsdoc_types(file);
        // `checkClassLikeDeclaration`, `checkInterfaceDeclaration`
        for c in 0..hir.classes.len() {
            if bound.class_symbol[c].is_some() && !self.is_never_checked(hir.classes[c].start) {
                let own = self.class_sym(file, ClassId(c as u32));
                self.base_constructor_type_of_class(own);
                self.base_types(own);
            }
        }
        for &symbol in bound.interface_symbol.iter().filter(|s| s.is_some()) {
            let own = self.files().sym(file, symbol);
            self.base_types(own);
        }
        for p in 0..hir.type_params.len() {
            let constraint = hir.type_params[p].constraint;
            if constraint.is_none()
                || bound.type_param_scope[p].is_none()
                || bound.type_param_symbol[p].is_none()
                || unchecked.contain(hir[constraint].pos)
            {
                continue;
            }
            let own = TypeParamId(p as u32);
            // `getConstraintDeclaration`: the declarations of a class or an interface declare one
            // type parameter.
            let (of, declaration, _) =
                self.type_param_declaration_with(file, own, |it: &TypeParam| it.constraint);
            if (of, declaration) != (file, own) {
                continue;
            }
            let param = self.type_param(file, own);
            if !self.has_non_circular_base_constraint(param) {
                let start = start_of_type(hir, constraint);
                let end = self.end_of_type_node_from(file, constraint, start);
                let name = self.atom_text(hir.type_params[p].name);
                let related = self.origin_of_circular_constraint(param, file, constraint);
                self.error_at((file, start, end), 2313, &[Arg::Bytes(&name)])
                    .related_information
                    .extend(related);
            }
        }
    }

    /// `getResolvedBaseConstraint`: 2313 for the key of the mapped type at `mapped`. A cycle has
    /// closed around the resolution of its base constraint.
    pub(super) fn report_circular_mapped_key(&mut self, file: FileId, mapped: TypeNodeId) {
        let hir = self.hir(file);
        let TypeNodeKind::Mapped(m) = hir[mapped].kind else {
            return;
        };
        let param = &hir[hir[m].param];
        // `GetDiagnostics` reads the diagnostics of a file once it has checked the file, in program
        // order. Diagnostics that the check of a later file adds to it are never read.
        let files = self.files();
        let order = |f: FileId| (!files.module(f).is_lib, files.rank_of_file(f));
        let is_read = (self.task.file).is_none_or(|checked| order(checked) <= order(file));
        let constraint = param.constraint;
        if constraint.is_none() || !is_read {
            return;
        }
        let start = start_of_type(hir, constraint);
        let end = self.end_of_type_node_from(file, constraint, start);
        let mut err = self.new_diagnostic((file, start, end), 2313, &[Arg::Atom(param.name)]);
        let key = self.type_param(file, hir[m].param);
        if !(self.circular_constraint_origins.iter()).any(|it| it.0 == key) {
            let current = self.current_node().or(self.current_source_element);
            let current = current.filter(|_| self.eager.is_empty());
            self.circular_constraint_origins.push((key, current));
        }
        if let Some(origin) = self.origin_of_circular_constraint(key, file, constraint) {
            err.add_related_info(origin);
        }
        self.add_diagnostic_of(Some(Query::TypeNode(file, constraint)), err);
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
                || self.is_never_checked(hir[pat].pos)
                || self.returns_before_type_of_symbol(file, pat)
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
                || self.is_never_checked(hir[member].start)
            {
                continue;
            }
            // `getTypeOfSymbol`: the properties and accessors among the declarations of one symbol
            // are one property, identified by the first.
            let is_first = bound.member_symbol[i].is_some() && {
                let sym = self.symbol_of_member(file, member);
                self.value_declaration_of_property(sym) == Some((file, Decl::Member(member)))
            };
            if is_first || hir[member].kind == MemberKind::Property {
                self.type_of_member_declaration(file, member);
            }
        }
        for i in 0..hir.fns.len() {
            let func = FnId(i as u32);
            if matches!(bound.fns[i].owner, FnOwner::None)
                || unchecked.contain(hir[func].start)
                || self.is_never_checked(hir[func].start)
            {
                continue;
            }
            // An annotated accessor of a class, an interface or a type literal was already
            // requested above, with the property it declares.
            let is_member = matches!(hir[func].kind, FnKind::Getter | FnKind::Setter)
                && !(hir[func].kind == FnKind::Getter
                    && matches!(bound.fns[i].owner, FnOwner::Expr(_)));
            if hir[func].ret.is_some() && !is_member
                || hir[func].ret.is_none()
                    && !matches!(hir[func].body, FnBody::None)
                    && self.is_inferred_return_type_requested(file, func)
            {
                self.return_type_of_fn(file, func);
            }
        }
        self.check_circular_exports(file);
        self.check_circular_assignment_declarations(file);
    }

    /// Whether the check of the declaration `func` requests its inferred return type.
    /// `checkFunctionOrMethodDeclaration` requests that of a generator only,
    /// `checkAccessorDeclaration` none for a setter, `checkReturnStatement` that of the function it
    /// is in.
    pub(super) fn is_inferred_return_type_requested(&self, file: FileId, func: FnId) -> bool {
        let (hir, info) = (self.hir(file), &self.bound(file).fns[func.idx()]);
        let is_requested_at_declaration = match hir[func].kind {
            FnKind::Setter => false,
            FnKind::Decl | FnKind::Method => {
                matches!(info.owner, FnOwner::Expr(_)) || hir[func].flags.contains(Flags::GENERATOR)
            }
            _ => true,
        };
        is_requested_at_declaration || !info.returns.is_empty()
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
            let node = hir[hir[s].func].effective_set_accessor_type_annotation_node(hir);
            node.is_some()
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
    /// `export = e` and `module.exports = e` are requested.
    fn check_circular_exports(&mut self, file: FileId) {
        for (i, symbol) in self.bound(file).symbols.iter().enumerate() {
            if symbol
                .flags
                .intersects(SymFlags::VARIABLE | SymFlags::PROPERTY)
                && matches!(
                    symbol.decls.first(),
                    Some(Decl::ExportExpr(_) | Decl::ModuleExports(_))
                )
            {
                let sym = self.files().sym(file, SymbolId(i as u32));
                self.type_of_symbol(sym);
            }
        }
    }

    /// `checkPropertyAccessExpression` resolves the type of a property declared by `f.a = e`, `this.a = e` or `exports.a = e` when
    /// it checks the left side, if that is the property it finds there: beside `module.exports = e`, `exports` has the type of `e`.
    /// `Object.defineProperty(f, "a", descriptor)` resolves it only if the descriptor reads the property.
    fn check_circular_assignment_declarations(&mut self, file: FileId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if !hir.is_js {
            return;
        }
        let of_this_or_exports = (bound.symbols.iter().flat_map(|symbol| &symbol.decls))
            .filter_map(|decl| match decl {
                Decl::ThisProperty(e) | Decl::ExportsProperty(e) => Some(e),
                _ => None,
            });
        for &declaration in (bound.expando_declarations.iter()).chain(of_this_or_exports) {
            let checked = match hir[declaration].kind {
                ExprKind::Assign { target, .. } => target,
                _ => declaration,
            };
            self.type_of_expr(file, checked);
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
    /// at the name of the function, 7024 at a function without a name. For an accessor of an object
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
        // `printed`: the position of the name in the message, if it is not that of `of`.
        let named = |c: &mut Self, of: FnId, code: u32, printed: Option<u32>| {
            if let Some(start) = c.name_of_function(file, of) {
                let end = c.end_of_name_at(file, start);
                let printed = printed.unwrap_or(start);
                let name = c.source_text(file, printed, c.end_of_name_at(file, printed));
                let err = c.new_diagnostic((file, start, end), code, &[Arg::Bytes(&name)]);
                c.add_diagnostic_of(owner, err);
                return true;
            }
            false
        };
        if matches!(hir[func].kind, FnKind::Getter | FnKind::Setter) {
            // The accessors of classes, interfaces and type literals are reported with the property
            // they declare.
            if let FnOwner::Expr(e) = fn_owner {
                // `symbolToString`: the name of the first declaration of the symbol.
                let symbol = match bound.expr_parent[e.idx()] {
                    Parent::Prop(p) => {
                        let first = self.first_declaration_of_literal_member(file, p);
                        Some(hir[first].pos)
                    }
                    _ => None,
                };
                let getter = (hir[func].kind == FnKind::Getter).then_some(func);
                let setter = match getter {
                    Some(getter) => (self.sibling_accessor(file, getter, FnKind::Setter))
                        .map(|(_, setter)| setter),
                    None => Some(func),
                };
                let setter = setter.filter(|&s| {
                    let node = hir[s].effective_set_accessor_type_annotation_node(hir);
                    node.is_some()
                });
                match (getter, setter) {
                    (Some(getter), _) if hir[getter].ret.is_some() => {
                        named(self, getter, 2502, symbol)
                    }
                    (_, Some(setter)) => named(self, setter, 2502, symbol),
                    (Some(getter), None) => no_implicit_any && named(self, getter, 7023, symbol),
                    (None, None) => false,
                };
            }
        } else if hir[func].ret.is_some() {
            let ret = hir[func].ret;
            let start = start_of_type(hir, ret);
            let at = (file, start, self.end_of_type_node_from(file, ret, start));
            let err = self.new_diagnostic(at, 2577, &[]);
            self.add_diagnostic_of(owner, err);
        } else if no_implicit_any
            && !matches!(hir[func].body, FnBody::None)
            && !named(self, func, 7023, None)
        {
            let (start, end) = self.error_range_of_fn(file, func);
            let err = self.new_diagnostic((file, start, end), 7024, &[]);
            self.add_diagnostic_of(owner, err);
        }
    }

    /// `getResolvedBaseConstraint`: 2751 at `c.currentNode` when the constraint of `param` was found
    /// to be circular, unless that node is in `error_node`, the constraint, or around it.
    fn origin_of_circular_constraint(
        &self,
        param: TypeId,
        file: FileId,
        error_node: TypeNodeId,
    ) -> Option<Reported> {
        let mut origins = self.circular_constraint_origins.iter();
        let current = origins.find(|it| it.0 == param)?.1?;
        let (of, current_node) = self.node_of_current_node(current);
        let hir = self.hir(file);
        let error_node = hir.node(error_node);
        // `isNodeDescendantOf`
        let is_in =
            |node: Node, ancestor: Node| hir.find_ancestor(node, |n| n == ancestor).is_some();
        if of == file && (is_in(error_node, current_node) || is_in(current_node, error_node)) {
            return None;
        }
        Some(Reported::bare(self.place_of_current_node(current), 2751))
    }
}

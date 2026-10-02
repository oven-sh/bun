//! What is `any` for want of anything that says what it is, under `noImplicitAny`: 7005 7006 7019 7051 7031 7008 7010 7011 7013 7020
//! 7032 7033 7039.
//!
//! Follows `reportImplicitAny` of TypeScript 7.0.2's checker.go and those who call it: `widenTypeForVariableLikeDeclaration`,
//! `getTypeFromBindingElement`, `checkFunctionOrMethodDeclaration`, `checkSignatureDeclaration`, `checkMappedType`,
//! `getWidenedTypeForAssignmentDeclaration`, `getAssignmentDeclarationInitializerType`, `reportErrorsFromWidening` as far as the
//! names in patterns go; and `getTypeOfAccessors`.

use super::errors::Diagnostic;
use super::*;
use crate::bind::{Decl, FnOwner, MemberOwner, Parent, SymbolId, UNREACHABLE};

/// `isEmptyArrayLiteralType`, decided by syntax because there is no `implicitNeverType`: `e` is written `[]`.
fn is_empty_array_literal(hir: &hir::File, e: ExprId) -> bool {
    matches!(hir[e].kind, ExprKind::Array(items) if items.is_empty())
}

/// `DeclarationNameToString(GetNameOfDeclaration(e))`, of `a.name = value`, `a["name"] = value` or
/// `Object.defineProperty(a, "name", descriptor)`.
fn name_of_assignment_declaration(c: &Checker<'_>, file: FileId, e: ExprId) -> String {
    let hir = c.hir(file);
    let written = |x: ExprId| c.source_text(file, c.start_of(file, x), c.end_of_expr(file, x));
    match hir[e].kind {
        ExprKind::Assign { target, .. } => match hir[target].kind {
            ExprKind::Dot { name, .. } => c.atom_text(name),
            // `GetElementOrPropertyAccessName`: a literal key, without the parentheses around it.
            ExprKind::Index { index, .. }
                if matches!(hir[index].kind, ExprKind::String(_) | ExprKind::Number(_))
                    || matches!(hir[index].kind, ExprKind::Template { exprs, .. } if exprs.is_empty()) =>
            {
                c.source_text(file, hir[index].pos, c.end_inside_parentheses(file, index))
            }
            _ => written(target),
        },
        _ => match crate::bind::define_property_call(hir, e) {
            Some((_, key)) => written(key),
            None => "(Missing)".to_owned(),
        },
    }
}

/// Notes what `reportImplicitAny` says of `e`, an assignment or a call of `Object.defineProperty` that declares a property of type
/// `ty`. The error is on the whole of `e`. Not `has_name`: it is `module.exports = value`.
fn explain_assignment_declaration(
    c: &mut Checker<'_>,
    file: FileId,
    e: ExprId,
    code: u32,
    has_name: bool,
    ty: &'static str,
) {
    let start = c.start_inside_parentheses(file, e);
    let end = c.end_inside_parentheses(file, e);
    c.explain_to(start, end, code, |c| {
        let name = if has_name {
            name_of_assignment_declaration(c, file, e)
        } else {
            "(Missing)".to_owned()
        };
        vec![name, ty.to_owned()]
    });
}

impl Checker<'_> {
    pub(super) fn check_implicit_any(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        if !self.p.files.options.no_implicit_any {
            return;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        for f in 0..hir.fns.len() {
            let func = FnId(f as u32);
            // `checkSignatureDeclaration` checks the parameters of an index signature like any others.
            if matches!(bound.fns[f].owner, FnOwner::None) || hir.fns[f].kind == FnKind::StaticBlock
            {
                continue;
            }
            let is_private_ambient = self.is_private_within_ambient(file, func);
            if !is_private_ambient {
                self.check_parameters_implicitly_any(file, func, out);
            }
            let decl = &hir.fns[f];
            // `getTypeOfAccessors`: what is written decides, a type on either or a body of the getter. What that comes to plays no part.
            if matches!(decl.kind, FnKind::Getter | FnKind::Setter) {
                if !is_private_ambient
                    && self.accessor_says_nothing(file, func)
                    && let Some(start) = self.start_of_accessor_name(file, func)
                {
                    if decl.kind == FnKind::Setter {
                        let getter = self.sibling_accessor(file, func, FnKind::Getter);
                        if getter.is_none_or(|g| self.accessor_says_nothing(file, g)) {
                            out.push(Diagnostic { start, code: 7032 });
                            let end = self.end_of_name_at(file, start);
                            self.explain_to(start, end, 7032, |c| {
                                vec![c.source_text(file, start, end)]
                            });
                        }
                    } else {
                        // The setter is the one to be told, if it can be.
                        let setter = self.sibling_accessor(file, func, FnKind::Setter);
                        if setter.is_none_or(|s| {
                            self.accessor_says_nothing(file, s)
                                && self.is_private_within_ambient(file, s)
                        }) {
                            out.push(Diagnostic { start, code: 7033 });
                            let end = self.end_of_name_at(file, start);
                            self.explain_to(start, end, 7033, |c| {
                                vec![c.source_text(file, start, end)]
                            });
                        }
                    }
                }
                continue;
            }
            if decl.ret.is_some()
                || !matches!(decl.body, FnBody::None)
                || decl.flags.contains(Flags::BODY_DROPPED)
            {
                continue;
            }
            // Nothing to go by: no body, and nothing said.
            match decl.kind {
                FnKind::ConstructSignature | FnKind::CallSignature => {
                    let code = if decl.kind == FnKind::ConstructSignature {
                        7013
                    } else {
                        7020
                    };
                    let start = self.start_of_signature(file, func);
                    out.push(Diagnostic { start, code });
                    let end = self.end_of_fn(file, func);
                    self.explain_to(start, end, code, |_| vec![]);
                }
                // `checkObjectLiteralMethod`, unlike `checkFunctionOrMethodDeclaration`, says nothing of a missing body.
                FnKind::Method if matches!(bound.fns[f].owner, FnOwner::Expr(_)) => {}
                FnKind::Decl | FnKind::Method if !is_private_ambient => {
                    // `reportImplicitAny`: one without a name is spoken of as a function expression is.
                    let code = if decl.kind == FnKind::Decl && decl.name.is_none() {
                        7011
                    } else if decl.flags.contains(Flags::REPARSED) {
                        7012
                    } else {
                        7010
                    };
                    let start = self.start_of_signature(file, func);
                    out.push(Diagnostic { start, code });
                    let is_missing = match bound.fns[f].owner {
                        FnOwner::Member(m) => {
                            matches!(hir[m].key, PropKey::None | PropKey::Name(known::empty))
                        }
                        _ => decl.name == known::empty,
                    };
                    // `GetErrorRangeForNode` has no case for a method signature: the error is on the whole of it. A name that is
                    // missing takes no room.
                    let (name_end, end) = match bound.fns[f].owner {
                        FnOwner::Member(m) => {
                            let name_end = self.end_of_member_name(file, m);
                            match bound.member_owner[m.idx()] {
                                MemberOwner::Class(_) if is_missing => {
                                    (name_end, super::explain::NO_LENGTH)
                                }
                                MemberOwner::Class(_) => (name_end, name_end),
                                _ => (name_end, hir[m].loc.end),
                            }
                        }
                        _ if is_missing => (start, super::explain::NO_LENGTH),
                        _ => (self.end_of_name_at(file, start), 0),
                    };
                    self.explain_to(start, end, code, |c| {
                        if matches!(code, 7011 | 7012) {
                            vec!["any".to_owned()]
                        } else if is_missing {
                            vec!["(Missing)".to_owned(), "any".to_owned()]
                        } else {
                            vec![c.source_text(file, start, name_end), "any".to_owned()]
                        }
                    });
                }
                _ => {}
            }
        }
        // Members that say nothing.
        let is_checked_js = hir.is_js && self.is_check_js(file);
        for m in 0..hir.members.len() {
            let member = &hir.members[m];
            if member.kind != MemberKind::Property || member.ty.is_some() {
                continue;
            }
            if member.init.is_some() {
                // `widenTypeInferredFromInitializer`: in a JavaScript file a property initialized with `[]` is an implicit `any[]`.
                if is_checked_js
                    && is_empty_array_literal(hir, member.init)
                    && !matches!(bound.member_owner[m], MemberOwner::None)
                {
                    out.push(Diagnostic {
                        start: member.pos,
                        code: 7008,
                    });
                    let end = self.end_of_member_name(file, MemberId(m as u32));
                    self.explain_to(member.pos, end, 7008, |c| {
                        vec![c.source_text(file, member.pos, end), "any[]".to_owned()]
                    });
                }
                continue;
            }
            match bound.member_owner[m] {
                MemberOwner::None => continue,
                MemberOwner::Class(c) => {
                    // `bindClassLikeDeclaration`: it is one symbol with the `prototype` of the class (`SymbolFlagsPrototype`), whose
                    // type is `getTypeOfPrototypeProperty`.
                    if member.flags.contains(Flags::STATIC)
                        && member.key == PropKey::Name(known::prototype)
                    {
                        continue;
                    }
                    // `isPrivateWithinAmbient`. A property that says `declare` is ambient by itself.
                    let is_ambient = hir[c].flags.contains(Flags::AMBIENT)
                        || member.flags.contains(Flags::AMBIENT)
                        || hir.kind == FileKind::Declaration;
                    if is_ambient
                        && (member.flags.contains(Flags::PRIVATE)
                            || matches!(member.key, PropKey::Private(_)))
                    {
                        continue;
                    }
                    // What a constructor or a static block assigns says what it is, be that `any`.
                    let id = MemberId(m as u32);
                    if !{
                        let ty = self.type_of_member_declaration(file, id);
                        self.has_any_flag(ty)
                    } || self.is_found_to_be_any(file, c, id)
                    {
                        continue;
                    }
                }
                _ => {}
            }
            out.push(Diagnostic {
                start: member.pos,
                code: 7008,
            });
            let end = self.end_of_member_name(file, MemberId(m as u32));
            self.explain_to(member.pos, end, 7008, |c| {
                vec![c.source_text(file, member.pos, end), "any".to_owned()]
            });
        }
        self.check_assignment_declarations_implicit_any(file, out);
        if is_checked_js {
            self.check_binding_element_defaults_implicit_any(file, out);
        }
        // The patterns of variable declarations that say nothing.
        for d in 0..hir.var_decls.len() {
            let decl = &hir.var_decls[d];
            let stmt = bound.var_stmt[d];
            if decl.ty.is_some()
                || !matches!(hir[decl.pat].kind, PatKind::Object(_) | PatKind::Array(_))
                || stmt.is_none()
                // What is caught is `unknown` or `any`.
                || !matches!(hir[stmt].kind, StmtKind::Var(_))
            {
                continue;
            }
            match bound.stmt_parent[stmt.idx()] {
                Parent::None => continue,
                // What is gone through says what the variable of a `for`-`in` or a `for`-`of` is.
                Parent::Stmt(l)
                    if l.is_some()
                        && matches!(hir[l].kind, StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } if left == stmt) =>
                {
                    continue;
                }
                _ => {}
            }
            if decl.init.is_none() {
                // `getTypeForVariableLikeDeclaration`: a pattern that is given nothing is what it implies.
                self.check_pattern_implicitly_any(file, decl.pat, out);
            } else if !self.p.files.options.strict_null_checks {
                self.check_widening_of_element(file, decl.pat, ExprId::NONE, decl.init, out);
            }
        }
        if hir.mapped.iter().all(|m| m.ty.is_some()) {
            return;
        }
        for (t, node) in hir.types.iter().enumerate() {
            if let TypeNodeKind::Mapped(m) = node.kind
                && hir[m].ty.is_none()
                && !bound.is_unchecked_type(t)
            {
                out.push(Diagnostic {
                    start: node.pos,
                    code: 7039,
                });
                let end = self.end_of_type_node(file, TypeNodeId(t as u32));
                self.explain_to(node.pos, end, 7039, |_| vec![]);
            }
        }
    }

    /// `widenTypeInferredFromInitializer`, as `getBindingElementTypeFromParentType` calls it: in a JavaScript file a binding element with
    /// the default `[]` and nothing else to go by is an implicit `any[]`. 7031.
    fn check_binding_element_defaults_implicit_any(
        &mut self,
        file: FileId,
        out: &mut Vec<Diagnostic>,
    ) {
        use crate::bind::PatParent;
        let (hir, bound) = (self.hir(file), self.bound(file));
        for i in 0..hir.pats.len() {
            let pat = PatId(i as u32);
            let PatKind::Ident(name) = hir.pats[i].kind else {
                continue;
            };
            let (pattern, default) = match bound.pat_parent[i] {
                PatParent::Prop(pattern, p) if !hir[p].is_rest => (pattern, hir[p].default),
                PatParent::Elem(pattern, e) if !hir[e].is_rest => (pattern, hir[e].default),
                _ => continue,
            };
            if default.is_none() || !is_empty_array_literal(hir, default) {
                continue;
            }
            // `WalkUpBindingElementsAndPatterns`
            let mut root = pattern;
            while let PatParent::Prop(outer, _) | PatParent::Elem(outer, _) =
                bound.pat_parent[root.idx()]
            {
                root = outer;
            }
            let is_annotated = match bound.pat_parent[root.idx()] {
                PatParent::Var(d) => hir[d].ty.is_some(),
                PatParent::Param(p) => hir[p].ty.is_some(),
                _ => true,
            };
            if is_annotated {
                continue;
            }
            let any_array = self.array_of(TypeId::ANY);
            if self.type_of_pat(file, pat) != any_array {
                continue;
            }
            // An `any[]` that was found for it is not implicit.
            let taken_apart = self.type_for_binding_element_parent(file, pat, pattern);
            if self.is_any(taken_apart) {
                continue;
            }
            let taken_apart = self.type_pattern_takes_apart(file, pattern, taken_apart);
            let found = match bound.pat_parent[i] {
                PatParent::Prop(_, p) => {
                    let Some(key) = self.member_name(file, hir[p].key) else {
                        continue;
                    };
                    self.type_of_property(taken_apart, key)
                }
                PatParent::Elem(_, e) => {
                    let PatKind::Array(elems) = hir[pattern].kind else {
                        continue;
                    };
                    let index = (e.0 - elems.start) as usize;
                    Some(self.element_of_destructured(taken_apart, index, false))
                }
                _ => continue,
            };
            let empty = self.type_of_expr(file, default);
            let whole = match found {
                Some(found) => {
                    let found = self.narrow_destructured(file, pat, found);
                    let present = self.non_undefined_type(found);
                    self.union_reduced(&[present, empty])
                }
                None => empty,
            };
            if whole != empty {
                continue;
            }
            let start = hir.pats[i].pos;
            out.push(Diagnostic { start, code: 7031 });
            let end = self.end_of_pat(file, pat);
            self.explain_to(start, end, 7031, |c| {
                vec![c.atom_text(name), "any[]".to_owned()]
            });
        }
    }

    /// `getWidenedTypeForAssignmentDeclaration`, `getAssignmentDeclarationInitializerType`: implicit `any` of the exports and
    /// properties that assignments declare. 7008 at each assignment of `[]`, in TypeScript files too. In a JavaScript file also at
    /// `symbol.ValueDeclaration` if every assigned type is `null` or `undefined`.
    fn check_assignment_declarations_implicit_any(
        &mut self,
        file: FileId,
        out: &mut Vec<Diagnostic>,
    ) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // `reportImplicitAny` reports nothing in a JavaScript file without `checkJs`.
        if hir.is_js && !self.is_check_js(file) {
            return;
        }
        if bound.commonjs_indicator.is_some() {
            for (i, symbol) in bound.symbols.iter().enumerate() {
                // `getTypeOfSymbol` resolves a symbol that is only an alias with `getTypeOfAlias`.
                if !symbol.flags.intersects(SymFlags::VALUE) {
                    continue;
                }
                let Some(value_declaration) = self.commonjs_value_declaration(file, symbol) else {
                    continue;
                };
                let mut is_nullable = self.assignment_declarations_are_nullable(
                    self.files().sym(file, SymbolId(i as u32)),
                );
                for &decl in &symbol.decls {
                    let (Decl::ModuleExports(assignment) | Decl::ExportsProperty(assignment)) =
                        decl
                    else {
                        continue;
                    };
                    // The declarations are read up to the first that says what it is.
                    if hir.jsdoc_type(JsDocTypeOwner::Assign(assignment)).is_some() {
                        break;
                    }
                    // `GetRightMostAssignedExpression` also steps through compound assignments.
                    let mut rightmost = assignment;
                    while let ExprKind::Assign { value, .. } = hir[rightmost].kind {
                        rightmost = value;
                    }
                    if is_empty_array_literal(hir, rightmost) {
                        out.push(Diagnostic {
                            start: self.start_inside_parentheses(file, assignment),
                            code: 7008,
                        });
                        let has_name = matches!(decl, Decl::ExportsProperty(_));
                        explain_assignment_declaration(
                            self, file, assignment, 7008, has_name, "any[]",
                        );
                    }
                    is_nullable &= !self.is_uncertain(file, rightmost);
                }
                if is_nullable {
                    out.push(Diagnostic {
                        start: self.start_inside_parentheses(file, value_declaration),
                        code: 7008,
                    });
                    let has_name = !symbol
                        .decls
                        .contains(&Decl::ModuleExports(value_declaration));
                    explain_assignment_declaration(
                        self,
                        file,
                        value_declaration,
                        7008,
                        has_name,
                        "any",
                    );
                }
            }
        }
        // The symbols that assignments add to.
        let parent = |&e: &ExprId| bound.symbols[bound.expr_symbol[e.idx()].idx()].parent;
        let mut owners: Vec<SymbolId> = bound.expando_declarations.iter().map(parent).collect();
        owners.sort_unstable();
        owners.dedup();
        for owner in owners {
            // Each run of equal names is one property.
            for of_name in self.expandos_of(file, owner).chunk_by(|a, b| a.0 == b.0) {
                let (name, first) = of_name[0];
                self.check_assigned_property_implicit_any(file, name, first, None, out);
            }
        }
        // The list is sorted: each run of equal (class, is_static, name) is one property.
        let properties = &bound.this_properties;
        let mut i = 0;
        while i < properties.len() {
            let (class, is_static, name, first) = properties[i];
            i += properties[i..]
                .iter()
                .take_while(|x| (x.0, x.1, x.2) == (class, is_static, name))
                .count();
            self.check_assigned_property_implicit_any(file, name, first, Some(class), out);
        }
    }

    /// Checks the property `name` whose first declaration (`symbol.ValueDeclaration`) is `first`: `f.name = value`,
    /// `this.name = value` or `Object.defineProperty(f, "name", descriptor)`. `class`: the class of a `this.name = value` property.
    fn check_assigned_property_implicit_any(
        &mut self,
        file: FileId,
        name: Atom,
        first: ExprId,
        class: Option<ClassId>,
        out: &mut Vec<Diagnostic>,
    ) {
        let hir = self.hir(file);
        // `reportImplicitAny` has a case for a binary expression. A call expression takes the default case.
        let (object, code) = match hir[first].kind {
            ExprKind::Assign { target, .. } => match hir[target].kind {
                ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => (obj, 7008),
                _ => return,
            },
            _ => match crate::bind::define_property_call(hir, first) {
                Some((object, _)) => (object, 7005),
                None => return,
            },
        };
        // Another declaration of the name, or a type annotation on the owner, takes precedence over the assignments.
        let owner = self.type_of_expr(file, object);
        let owner = self.apparent_type(owner);
        let Some((prop, _)) = self.prop_of(owner, name) else {
            return;
        };
        let PropSource::Assigned(declared_in, declarations) = &prop.source else {
            return;
        };
        if *declared_in != file || declarations.first() != Some(&first) {
            return;
        }
        // Whether tsgo takes the type from the declarations, which is where it reports an assignment of `[]`.
        let mut reads_declarations = true;
        let is_annotated = |e: ExprId| hir.jsdoc_type(JsDocTypeOwner::Assign(e)).is_some();
        if class.is_some() && declarations.iter().any(|&e| is_annotated(e)) {
            // `thisAssignmentDeclarationTyped`: the annotation is all that is read.
            reads_declarations = false;
        } else if let Some(class) = class {
            let is_in_constructor = |e: &&ExprId| matches!(self.this_container(file, **e), Some(Ok(func)) if hir[func].kind == FnKind::Constructor);
            let in_constructor = declarations.iter().filter(is_in_constructor).count();
            if in_constructor == declarations.len() {
                // `thisAssignmentDeclarationConstructor`: an access in the declaring constructor has `autoType`
                // (`isThisPropertyAccessInConstructor`), so tsgo resolves the type of the property, and reports, only if another
                // access needs it. Only the left side of an assignment outside the constructor is known to be such an access.
                return;
            }
            reads_declarations = if in_constructor != 0 {
                // Only if `getFlowTypeInConstructor` finds no type, which is not known here.
                false
            } else {
                // `thisAssignmentDeclarationMethod`: only if `getTypeOfPropertyInBaseClass` finds no property.
                let base = self
                    .base_types(self.class_sym(file, class))
                    .first()
                    .copied();
                !base.is_some_and(|base| {
                    let base = self.apparent_type(base);
                    self.prop_of(base, name).is_some()
                })
            };
        }
        if reads_declarations {
            for &declaration in declarations.iter() {
                // The declarations are read up to the first that says what it is.
                if is_annotated(declaration) {
                    break;
                }
                let ExprKind::Assign { target, value, .. } = hir[declaration].kind else {
                    continue;
                };
                // The type of `a = []` is the type of `[]`.
                let mut rightmost = value;
                while let ExprKind::Assign {
                    op: None,
                    value: next,
                    ..
                } = hir[rightmost].kind
                {
                    rightmost = next;
                }
                // `hasParentWithTypeAnnotation`
                if is_empty_array_literal(hir, rightmost)
                    && !self.is_property_of_annotated_variable(file, target)
                {
                    out.push(Diagnostic {
                        start: self.start_inside_parentheses(file, declaration),
                        code: 7008,
                    });
                    explain_assignment_declaration(self, file, declaration, 7008, true, "any[]");
                }
            }
        }
        if !hir.is_js {
            return;
        }
        let ty = self.widened_type_of_assignments(file, name, declarations);
        let is_uncertain = declarations.iter().any(|&e| matches!(hir[e].kind, ExprKind::Assign { value, .. } if self.is_uncertain(file, value)));
        if self.is_known(ty) && !is_uncertain && self.is_all_null_or_undefined(ty) {
            out.push(Diagnostic {
                start: self.start_inside_parentheses(file, first),
                code,
            });
            explain_assignment_declaration(self, file, first, code, true, "any");
        }
    }

    /// `isPrivateWithinAmbient`, of the member `func` is.
    fn is_private_within_ambient(&self, file: FileId, func: FnId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let FnOwner::Member(m) = bound.fns[func.idx()].owner else {
            return false;
        };
        let MemberOwner::Class(c) = bound.member_owner[m.idx()] else {
            return false;
        };
        // `parseClassElement`: a member that says `declare` is ambient by itself.
        (hir[c].flags.contains(Flags::AMBIENT)
            || hir[m].flags.contains(Flags::AMBIENT)
            || hir.kind == FileKind::Declaration)
            && (hir[m].flags.contains(Flags::PRIVATE) || matches!(hir[m].key, PropKey::Private(_)))
    }

    /// Whether the accessor `func` gives `getTypeOfAccessors` nothing to go by: a getter neither a type nor a body, a setter no type
    /// for what it takes.
    fn accessor_says_nothing(&self, file: FileId, func: FnId) -> bool {
        let hir = self.hir(file);
        let f = &hir[func];
        match f.kind {
            FnKind::Getter => {
                f.ret.is_none()
                    && matches!(f.body, FnBody::None)
                    && !f.flags.contains(Flags::BODY_DROPPED)
            }
            _ => f.params.iter().next().is_none_or(|p| hir[p].ty.is_none()),
        }
    }

    /// Where the name of the accessor `func` starts. `None`: which property it is cannot be told.
    fn start_of_accessor_name(&mut self, file: FileId, func: FnId) -> Option<u32> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (key, pos) = match bound.fns[func.idx()].owner {
            FnOwner::Member(m) => (hir[m].key, hir[m].pos),
            FnOwner::Expr(e) => match bound.expr_parent[e.idx()] {
                Parent::Prop(p) => (hir[p].key, hir[p].pos),
                _ => return None,
            },
            _ => return None,
        };
        match key {
            PropKey::None => return None,
            // `hasBindableName`: a name that is worked out and is no literal or unique symbol makes a property of its own.
            PropKey::Computed(k) if self.member_name(file, key).is_none() => {
                let ty = self.type_of_expr(file, k);
                if !self.is_known(ty) || self.is_uncertain(file, k) {
                    return None;
                }
            }
            _ => {}
        }
        Some(pos)
    }

    /// `getTypeForVariableLikeDeclaration`, of the property `m` of the class `c`, which says nothing and has come to be `any`: whether
    /// that was found for it, in what the constructor or a static block assigns or, for one that says `declare` where there is
    /// neither, in the class extended. Where a static block is left is not always kept: it counts as found then.
    fn is_found_to_be_any(&mut self, file: FileId, c: ClassId, m: MemberId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let member = &hir[m];
        let Some(name) = self.member_name(file, member.key) else {
            // Nothing is assigned to a name that is worked out and could be anything. Whether it could has to be known.
            let PropKey::Computed(k) = member.key else {
                return false;
            };
            let ty = self.type_of_expr(file, k);
            return !self.is_known(ty);
        };
        let is_static = member.flags.contains(Flags::STATIC);
        let mut is_looked_for = false;
        for other in hir[c].members.iter() {
            let func = hir[other].func;
            let is_where_to_look = if is_static {
                hir[other].kind == MemberKind::StaticBlock
            } else {
                // `FindConstructorDeclaration`: the first that has a body.
                !is_looked_for
                    && hir[other].kind == MemberKind::Constructor
                    && !matches!(hir[func].body, FnBody::None)
            };
            if !is_where_to_look {
                continue;
            }
            is_looked_for = true;
            if func.is_none() {
                return true;
            }
            // `getTypeAtFlowNode`: where control cannot get to, it is `any` and no more is asked.
            let exit = bound.fns[func.idx()].exit;
            if exit.is_none()
                || exit == UNREACHABLE
                || self.flow_type_in_constructor(file, func, name).is_some()
            {
                return true;
            }
        }
        if is_looked_for
            || !member.flags.contains(Flags::AMBIENT)
            || hir[c].flags.contains(Flags::AMBIENT)
        {
            return false;
        }
        // `getTypeOfPropertyInBaseClass`
        let class = self.class_sym(file, c);
        let base = self.base_types(class).first().copied();
        base.is_some_and(|base| {
            let base = self.apparent_type(base);
            self.prop_of(base, name).is_some()
        })
    }

    /// Where an error about `func` as a whole goes: its name if it has one.
    fn start_of_signature(&self, file: FileId, func: FnId) -> u32 {
        let (hir, bound) = (self.hir(file), self.bound(file));
        match bound.fns[func.idx()].owner {
            FnOwner::Member(m) => hir[m].pos,
            _ if hir[func].name.is_some() => hir[func].name_pos,
            _ => hir[func].pos,
        }
    }

    fn check_parameters_implicitly_any(
        &mut self,
        file: FileId,
        func: FnId,
        out: &mut Vec<Diagnostic>,
    ) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let decl = &hir[func];
        // `getParameterTypeOfFullSignature` gives every parameter a type, if only `any`.
        if self.full_signature(file, func).is_some() {
            return;
        }
        let mut context_is_known = None;
        // A leading `this` parameter is not among `params`. The type of a `@this` tag is not its own: the tag is dropped if `this`
        // is written. In a function type that is itself written in a comment, what follows `this:` is.
        if !matches!(decl.kind, FnKind::Getter | FnKind::Setter)
            && let Some(start) = super::errors_x_signatures::this_parameter(hir, func)
            && (decl.this_ty(hir).is_none()
                || hir.is_in_jsdoc(hir[decl.this_ty(hir)].pos) && !hir.is_in_jsdoc(start))
        {
            // `getContextualThisParameterType`
            let is_told = match bound.fns[func.idx()].owner {
                FnOwner::Expr(e) => {
                    self.contextual_signature(file, func)
                        .is_some_and(|sig| self.sig_this_type(sig).is_some())
                        || !*context_is_known.get_or_insert_with(|| self.is_context_known(file, e))
                }
                _ => false,
            };
            if !is_told {
                out.push(Diagnostic { start, code: 7006 });
                self.explain_to(start, start + 4, 7006, |_| {
                    vec!["this".to_owned(), "any".to_owned()]
                });
            }
        }
        for (index, p) in decl.params.iter().enumerate() {
            let param = &hir[p];
            // Whether something is expected of it, once that has been asked.
            let mut is_expected = None;
            if matches!(hir[param.pat].kind, PatKind::Object(_) | PatKind::Array(_)) {
                let is_told = if param.ty.is_some() {
                    // `getBindingElementTypeFromParentType`: below an annotation the defaults are only looked at to see whether they
                    // can be `undefined`.
                    self.p.files.options.strict_null_checks
                } else if let FnOwner::Expr(e) = bound.fns[func.idx()].owner {
                    // What a default is depends on what is expected of it.
                    *is_expected.insert(self.contextual_param_type(file, func, index).is_some())
                        || *context_is_known.get_or_insert_with(|| self.is_context_known(file, e))
                } else {
                    true
                };
                if is_told {
                    // What is written out says what the parameter is, whatever its own default.
                    let own = if param.ty.is_none() {
                        param.default
                    } else {
                        ExprId::NONE
                    };
                    self.check_padded_defaults(file, param.pat, own, out);
                }
                // Of a function expression something may be expected, which comes before the default.
                if param.ty.is_none()
                    && param.default.is_some()
                    && !self.p.files.options.strict_null_checks
                    && !matches!(bound.fns[func.idx()].owner, FnOwner::Expr(_))
                {
                    self.check_widening_of_element(
                        file,
                        param.pat,
                        ExprId::NONE,
                        param.default,
                        out,
                    );
                }
            }
            // `widenTypeInferredFromInitializer`: in a JavaScript file a parameter that defaults to `[]` is an implicit `any[]`.
            // Without `strictNullChecks` the widening of `undefined[]` says so.
            if hir.is_js
                && self.p.files.options.strict_null_checks
                && decl.kind != FnKind::Setter
                && param.ty.is_none()
                && param.default.is_some()
                && !param.flags.contains(Flags::REST)
                && is_empty_array_literal(hir, param.default)
                && let PatKind::Ident(name) = hir[param.pat].kind
                && hir.jsdoc_type(JsDocTypeOwner::Fn(func)).is_none()
                && self.is_check_js(file)
                && match bound.fns[func.idx()].owner {
                    FnOwner::Expr(e) => {
                        self.contextual_param_type(file, func, index).is_none()
                            && *context_is_known
                                .get_or_insert_with(|| self.is_context_known(file, e))
                    }
                    _ => true,
                }
            {
                out.push(Diagnostic {
                    start: param.pos,
                    code: 7006,
                });
                let end = self.end_of_param(file, p);
                self.explain_to(param.pos, end, 7006, |c| {
                    vec![c.atom_text(name), "any[]".to_owned()]
                });
            }
            if param.ty.is_some() || param.default.is_some() {
                continue;
            }
            if decl.kind == FnKind::Setter {
                // `getTypeForVariableLikeDeclaration`: the getter says what its setter takes, whatever that comes to, and nothing else
                // is ever expected of it (`isContextSensitiveFunctionOrObjectLiteralMethod`).
                if self.sibling_accessor(file, func, FnKind::Getter).is_some()
                    || self.start_of_accessor_name(file, func).is_none()
                {
                    continue;
                }
            } else {
                // What it was found to be when the function was looked at, with all that was known then.
                let resolved = self.type_of_param(file, p);
                let is_any = match hir[param.pat].kind {
                    PatKind::Ident(_) if param.flags.contains(Flags::REST) => {
                        // `assignParameterType` adds the `?` after `widenTypeForVariableLikeDeclaration` has reported.
                        let widened = if param.flags.contains(Flags::OPTIONAL) {
                            self.without_undefined(resolved)
                        } else {
                            resolved
                        };
                        self.array_element(widened)
                            .is_some_and(|ty| self.has_any_flag(ty))
                    }
                    PatKind::Ident(_) => self.has_any_flag(resolved),
                    _ => true,
                };
                if !is_any {
                    continue;
                }
                if let FnOwner::Expr(e) = bound.fns[func.idx()].owner {
                    let is_expected = match is_expected {
                        Some(is_expected) => is_expected,
                        None => self.contextual_param_type(file, func, index).is_some(),
                    };
                    if is_expected {
                        continue;
                    }
                    // Nothing is expected of it, as far as can be told.
                    if !*context_is_known.get_or_insert_with(|| self.is_context_known(file, e)) {
                        return;
                    }
                }
            }
            match hir[param.pat].kind {
                PatKind::Ident(name) => {
                    let is_signature = matches!(
                        decl.kind,
                        FnKind::CallSignature | FnKind::FunctionType
                    ) || decl.kind == FnKind::Method
                        && matches!(bound.fns[func.idx()].owner, FnOwner::Member(m) if !matches!(bound.member_owner[m.idx()], MemberOwner::Class(_)));
                    let code = if is_signature && self.is_name_of_a_type(file, func, name) {
                        7051
                    } else if param.flags.contains(Flags::REST) {
                        7019
                    } else {
                        7006
                    };
                    out.push(Diagnostic {
                        start: param.pos,
                        code,
                    });
                    let is_rest = param.flags.contains(Flags::REST);
                    // A leading `this` parameter is counted, and is not among `params`.
                    let position = index + usize::from(decl.this_ty(hir).is_some());
                    // A parameter of which nothing is written takes no room.
                    let end = match self.end_of_param(file, p) {
                        end if name == known::empty && end <= param.pos => {
                            super::explain::NO_LENGTH
                        }
                        end => end,
                    };
                    self.explain_to(param.pos, end, code, |c| {
                        let name = if name == known::empty {
                            "(Missing)".to_owned()
                        } else {
                            c.atom_text(name)
                        };
                        match code {
                            7051 if is_rest => vec![format!("arg{position}"), name + "[]"],
                            7051 => vec![format!("arg{position}"), name],
                            7019 => vec![name, "any[]".to_owned()],
                            _ => vec![name, "any".to_owned()],
                        }
                    });
                }
                PatKind::Object(_) | PatKind::Array(_) => {
                    self.check_pattern_implicitly_any(file, param.pat, out)
                }
                _ => {}
            }
        }
    }

    /// `(string) => void` was meant to be `(arg0: string) => void`. `IsTypeNodeKind`
    fn is_name_of_a_type(&self, file: FileId, func: FnId, name: Atom) -> bool {
        const KEYWORDS: [&[u8]; 12] = [
            b"any",
            b"unknown",
            b"number",
            b"bigint",
            b"object",
            b"boolean",
            b"string",
            b"symbol",
            b"void",
            b"undefined",
            b"never",
            b"intrinsic",
        ];
        if KEYWORDS.contains(&self.files().atoms.bytes(name)) {
            return true;
        }
        let scope = self.bound(file).fns[func.idx()].scope;
        scope.is_some()
            && self
                .files()
                .resolve_name(file, scope, name, SymFlags::TYPE)
                .is_some()
    }

    /// `getTypeFromBindingPattern` with `reportErrors`: each name in a pattern that nothing gives a type.
    fn check_pattern_implicitly_any(
        &mut self,
        file: FileId,
        pat: PatId,
        out: &mut Vec<Diagnostic>,
    ) {
        let hir = self.hir(file);
        let mut elements: Vec<(PatId, ExprId)> = Vec::new();
        match hir[pat].kind {
            PatKind::Object(props) => {
                for p in props.iter() {
                    // What is left over is an object, whatever there is. A name that has to be worked out and could be anything
                    // leaves nothing in the implied type.
                    if !hir[p].is_rest && self.member_name(file, hir[p].key).is_some() {
                        elements.push((hir[p].value, hir[p].default));
                    }
                }
            }
            PatKind::Array(elems) => {
                // `[...rest]` is an array of anything, and no more is asked.
                if elems.len() == 1 && hir[elems.at(0)].is_rest {
                    return;
                }
                elements.extend(elems.iter().map(|e| (hir[e].pat, hir[e].default)));
            }
            _ => return,
        }
        for (element, default) in elements {
            if default.is_some() {
                continue;
            }
            match hir[element].kind {
                // `getTypeFromBindingElement`: what it comes to be plays no part.
                PatKind::Ident(name) => {
                    let start = hir[element].pos;
                    out.push(Diagnostic { start, code: 7031 });
                    if name == known::empty {
                        self.explain_to(start, super::explain::NO_LENGTH, 7031, |_| {
                            vec!["(Missing)".to_owned(), "any".to_owned()]
                        });
                    }
                }
                PatKind::Object(_) | PatKind::Array(_) => {
                    self.check_pattern_implicitly_any(file, element, out)
                }
                _ => {}
            }
        }
    }

    /// `reportErrorsFromWidening`, of the names in a pattern that takes a literal apart, where `null` and `undefined` are not told
    /// apart: 7031. One that is written becomes `any`, one that is declared does not, so this goes by what is written. `pat` is given
    /// `value`, or `default` if there is one and `value` is `undefined`.
    fn check_widening_of_element(
        &self,
        file: FileId,
        pat: PatId,
        default: ExprId,
        value: ExprId,
        out: &mut Vec<Diagnostic>,
    ) {
        let hir = self.hir(file);
        match (hir[pat].kind, hir[value].kind) {
            (PatKind::Ident(_), _) => {
                // `null` and `undefined` go from a union with anything else.
                if self.is_widening_literal(file, value)
                    && (default.is_none() || self.is_widening_literal(file, default))
                    && self.is_first_declaration(file, pat)
                {
                    out.push(Diagnostic {
                        start: hir[pat].pos,
                        code: 7031,
                    });
                }
            }
            // What comes of a default and a value that are both taken apart is not looked into.
            _ if default.is_some() => {}
            (PatKind::Array(elems), ExprKind::Array(items)) => {
                // `getTypeFromArrayBindingPattern`: `[...rest]` alone expects something to go through, no tuple, so the literal is an
                // array of what it holds.
                if elems.len() == 1 && hir[elems.at(0)].is_rest {
                    let rest = hir[elems.at(0)].pat;
                    if matches!(hir[rest].kind, PatKind::Ident(_)) {
                        self.check_widening_of_element(file, rest, ExprId::NONE, value, out);
                    }
                    return;
                }
                self.check_widening_of_elements(file, elems, items, 0, out);
            }
            (PatKind::Object(props), ExprKind::Object(given)) => {
                // What a spread or a name that is worked out puts in the literal is not looked into.
                if given.iter().any(|g| {
                    hir[g].kind == PropKind::Spread || matches!(hir[g].key, PropKey::Computed(_))
                }) {
                    return;
                }
                for p in props.iter() {
                    let prop = &hir[p];
                    // `getRestType`: what is left over is put in an object of its own, of which nothing is said.
                    if prop.is_rest || !matches!(prop.key, PropKey::Name(_)) {
                        continue;
                    }
                    // The last of a name is the one that counts.
                    if let Some(g) = given.iter().rev().find(|&g| hir[g].key == prop.key)
                        && hir[g].kind == PropKind::Init
                        && hir[g].value.is_some()
                    {
                        self.check_widening_of_element(
                            file,
                            prop.value,
                            prop.default,
                            hir[g].value,
                            out,
                        );
                    }
                }
            }
            _ => {}
        }
    }

    /// The same, of the array pattern `elems`, which takes apart the tuple of `items` from the one at `from` on.
    fn check_widening_of_elements(
        &self,
        file: FileId,
        elems: Span<PatElemId>,
        items: IdList<ExprId>,
        from: usize,
        out: &mut Vec<Diagnostic>,
    ) {
        let hir = self.hir(file);
        let mut left = hir.ids(items).skip(from);
        for (i, e) in elems.iter().enumerate() {
            let elem = &hir[e];
            if elem.is_rest {
                // `sliceTupleType`: a tuple of what is left. In an object literal there are properties to point at instead: 7018.
                match hir[elem.pat].kind {
                    PatKind::Ident(_) => {
                        if !left.clone().any(|x| {
                            matches!(hir[x].kind, ExprKind::Spread(_) | ExprKind::Object(_))
                        }) && left.any(|x| self.is_widening_literal(file, x))
                            && self.is_first_declaration(file, elem.pat)
                        {
                            out.push(Diagnostic {
                                start: hir[elem.pat].pos,
                                code: 7031,
                            });
                        }
                    }
                    PatKind::Array(inner) => {
                        self.check_widening_of_elements(file, inner, items, from + i, out)
                    }
                    _ => {}
                }
                return;
            }
            // From a spread on, what goes where is not looked into.
            let Some(item) = left.next() else { return };
            if matches!(hir[item].kind, ExprKind::Spread(_)) {
                return;
            }
            self.check_widening_of_element(file, elem.pat, elem.default, item, out);
        }
    }

    /// Whether the type of `e` is made of nothing but the `null` and `undefined` that widen (`nullWideningType`,
    /// `undefinedWideningType`): `null`, `undefined`, `void x`, a hole, or an array of nothing else, which `[]` is too.
    fn is_widening_literal(&self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Null | ExprKind::Missing | ExprKind::Unary { op: UnOp::Void, .. } => true,
            ExprKind::Ident(name) => {
                name == known::undefined && self.bound(file).expr_symbol[e.idx()].is_none()
            }
            ExprKind::NonNull(x) => self.is_widening_literal(file, x),
            ExprKind::Array(items) => hir
                .ids(items)
                .all(|item| self.is_widening_literal(file, item)),
            _ => false,
        }
    }

    /// Whether `pat` is the first declaration of the variable or parameter it names, which is the one the type is taken from
    /// (`symbol.ValueDeclaration`) and the only one to be told.
    fn is_first_declaration(&self, file: FileId, pat: PatId) -> bool {
        let bound = self.bound(file);
        let symbol = bound.pat_symbol[pat.idx()];
        if symbol.is_none() {
            return false;
        }
        let s = &bound.symbols[symbol.idx()];
        let Some(&first @ (Decl::Var(p) | Decl::Param(p))) = s.decls.first() else {
            return false;
        };
        p == pat
            && (!s.flags.contains(SymFlags::MERGED)
                || self.files().decls(self.files().sym(file, symbol)).first()
                    == Some(&(file, first)))
    }

    /// `padTupleType`: where the default of an array pattern in a parameter is a tuple too short for the pattern, what is past its end
    /// is `any`, and nothing says so. `default`: that of `pat`, if it is looked at.
    fn check_padded_defaults(
        &mut self,
        file: FileId,
        pat: PatId,
        default: ExprId,
        out: &mut Vec<Diagnostic>,
    ) {
        let hir = self.hir(file);
        if !matches!(hir[pat].kind, PatKind::Object(_) | PatKind::Array(_)) {
            return;
        }
        if default.is_some()
            && let PatKind::Array(elems) = hir[pat].kind
        {
            let ty = self.type_of_expr(file, default);
            let arity = match self.data(ty) {
                TypeData::Tuple {
                    elems: types,
                    flags,
                    ..
                } if !flags
                    .iter()
                    .any(|f| f.intersects(ElemFlags::REST | ElemFlags::VARIADIC)) =>
                {
                    Some(types.len())
                }
                _ => None,
            };
            if let Some(arity) = arity
                && !self.is_uncertain(file, default)
            {
                for (i, e) in elems.iter().enumerate().skip(arity) {
                    let elem = &hir[e];
                    if i + 1 == elems.len() && elem.is_rest {
                        break;
                    }
                    // A hole is an element without a name, and is told off like the rest.
                    if elem.default.is_none() {
                        let start = hir[elem.pat].pos;
                        out.push(Diagnostic { start, code: 7031 });
                        let end = self.end_of_pat(file, elem.pat);
                        let is_missing = matches!(
                            hir[elem.pat].kind,
                            PatKind::Missing | PatKind::Ident(known::empty)
                        );
                        self.explain_to(start, end, 7031, |c| {
                            if is_missing {
                                vec!["(Missing)".to_owned(), "any".to_owned()]
                            } else {
                                vec![c.source_text(file, start, end), "any".to_owned()]
                            }
                        });
                    }
                }
            }
        }
        // `getBindingElementTypeFromParentType`: what comes out of `any` is `any`, and its defaults are not looked at.
        let taken_apart = self.type_of_pat(file, pat);
        if self.is_any(taken_apart) || !self.is_known(taken_apart) {
            return;
        }
        match hir[pat].kind {
            PatKind::Object(props) => props
                .iter()
                .for_each(|p| self.check_padded_defaults(file, hir[p].value, hir[p].default, out)),
            PatKind::Array(elems) => elems
                .iter()
                .for_each(|e| self.check_padded_defaults(file, hir[e].pat, hir[e].default, out)),
            _ => {}
        }
    }

    /// Whether it can be told what is expected of `e`, so that nothing being expected means just that.
    pub(super) fn is_context_known(&mut self, file: FileId, mut e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        loop {
            match bound.expr_parent[e.idx()] {
                Parent::Prop(p) => e = bound.prop_owner[p.idx()],
                Parent::Expr(parent) => match hir[parent].kind {
                    ExprKind::Call(c) | ExprKind::New(c) if hir[c].callee != e => {
                        let callee = self.type_of_expr(file, hir[c].callee);
                        return self.is_known(callee) && !self.is_uncertain(file, hir[c].callee);
                    }
                    ExprKind::Object(_)
                    | ExprKind::Array(_)
                    | ExprKind::Cond { .. }
                    | ExprKind::Spread(_)
                    | ExprKind::NonNull(_)
                    | ExprKind::AsConst(_)
                    | ExprKind::Satisfies { .. }
                    | ExprKind::Binary {
                        op: BinOp::Or | BinOp::And | BinOp::Nullish | BinOp::Comma,
                        ..
                    } => e = parent,
                    ExprKind::Assign { target, .. } => {
                        let ty = self.type_of_expr(file, target);
                        return self.is_known(ty);
                    }
                    ExprKind::Jsx(j) => {
                        // `getContextualTypeForChildJsxExpression`: nothing is expected of a child of a fragment, nor where children go
                        // by no name.
                        let tag = hir[j].tag;
                        if tag.is_none()
                            || !matches!(
                                self.jsx_children_property_name(file),
                                super::jsx::JsxName::Name(_)
                            )
                        {
                            return true;
                        }
                        // Otherwise it is the `children` of what the tag takes, which is looked up by name for `<div>`.
                        if self.jsx_intrinsic_tag_name(file, tag).is_none() {
                            let component = self.type_of_expr(file, tag);
                            if !self.is_known(component) || self.is_uncertain(file, tag) {
                                return false;
                            }
                        }
                        return self
                            .jsx_props_type(file, parent)
                            .is_none_or(|props| self.is_known(props));
                    }
                    _ => return true,
                },
                Parent::VarInit(d) => {
                    return hir[d].ty.is_none() || {
                        let ty = self.type_from_node(file, hir[d].ty);
                        self.is_known(ty)
                    };
                }
                Parent::Stmt(_) | Parent::FnBody(_) => {
                    // What is returned is expected to be what the function around returns.
                    return match self.contextual_type(file, e) {
                        Some(ty) => self.is_known(ty),
                        None => true,
                    };
                }
                _ => return true,
            }
        }
    }
}

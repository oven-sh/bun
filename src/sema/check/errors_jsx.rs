//! Errors about JSX: 17004 2874 2875 2879 and what is said in their place, 7026 and 2339 for tags that are not components, 2604 2322
//! 2769 6229 for what a tag takes, 2558 2743 2344 for its type arguments, 2745 2746 2747 2710 for children, 2783 for what a spread
//! overwrites, 2786.
//!
//! Follows `checkJsxOpeningLikeElementOrOpeningFragment`, `checkJsxPreconditions`, `getIntrinsicTagSymbol`,
//! `getJsxNamespace`, `getJsxFactoryEntity`, `getJsxNamespaceContainerForImplicitImport`, `getJSXFragmentType`,
//! `resolveJsxOpeningLikeElement`, `elaborateJsxComponents` and `checkJsxReturnAssignableToAppropriateBound` of TypeScript 7.0.2's
//! jsx.go, and `markJsxAliasReferenced`, `checkNodeDeferred`, `checkSpreadPropOverrides`, `getTypeArgumentArityError` and
//! `getCandidateForOverloadFailure` of its checker.go.

use super::errors::Diagnostic;
use super::jsx::JsxName;
use super::*;
use crate::bind::{Parent, ScopeId};
use crate::resolve::JsxEmit;

impl Checker<'_> {
    pub(super) fn check_jsx(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if hir.jsx.is_empty() {
            return;
        }
        let options = &self.p.files.options;
        let (jsx, no_implicit_any) = (options.jsx, options.no_implicit_any);
        let atoms = &self.p.files.atoms;
        let runtime =
            crate::program::jsx_runtime_of(options, hir, atoms).map(|spec| atoms.intern_str(&spec));
        // `getJsxNamespaceContainerForImplicitImport`: the module elements are made with is imported unasked, and has to be there.
        let runtime_is_missing =
            runtime.is_some_and(|spec| self.files().module_of_specifier(file, spec).is_none());
        // `resolveExternalModule`: of a file that is found and is no module, that is what is said.
        let runtime_is_no_module =
            runtime.is_some_and(|spec| self.files().module(file).imported_file(spec).is_some());
        let (factory, fragment_factory) = jsx_factory_names(self.files(), hir);
        let names_fragment_factory = atoms.bytes(fragment_factory) != b"null";
        // `markJsxAliasReferenced`: a module that is not found is as good as none asked for.
        let imports_nothing = runtime.is_none() || runtime_is_missing;
        let checks_factory = imports_nothing && jsx == JsxEmit::React;
        // `getJSXFragmentType`
        let checks_fragment_type = imports_nothing
            && names_fragment_factory
            && (jsx == JsxEmit::React || !options.jsx_fragment_factory.is_empty());
        // Where tags are kept as they are written an enum will not do.
        let meaning = if matches!(jsx, JsxEmit::Preserve | JsxEmit::ReactNative) {
            SymFlags::VALUE.difference(SymFlags::ENUM)
        } else {
            SymFlags::VALUE
        };
        let is_missing = |c: &Self, scope: ScopeId, name: Atom| {
            c.files().resolve_name(file, scope, name, meaning).is_none()
        };
        let intrinsic_elements = self.jsx_type(file, known::IntrinsicElements);
        let mut elements: Vec<ExprId> = self
            .exprs_by_kind(file)
            .of(ExprTag::Jsx)
            .iter()
            .copied()
            .filter(|e| !matches!(bound.expr_parent[e.idx()], Parent::None))
            .collect();
        elements.sort_unstable_by_key(|&e| hir[e].pos);
        // What is said once for the file is said of what is looked at first.
        let (mut first, mut first_fragment) = (None, None);
        if runtime_is_missing || checks_fragment_type {
            let (mut least, mut least_of_fragments) = (u32::MAX, u32::MAX);
            for &e in &elements {
                let ExprKind::Jsx(j) = hir[e].kind else {
                    continue;
                };
                let is_fragment = hir[j].tag.is_none();
                if !runtime_is_missing && !is_fragment {
                    continue;
                }
                let depth = self.jsx_deferral_depth(file, e);
                if depth < least {
                    (least, first) = (depth, Some(e));
                }
                if is_fragment && depth < least_of_fragments {
                    (least_of_fragments, first_fragment) = (depth, Some(e));
                }
            }
        }
        for e in elements {
            let ExprKind::Jsx(j) = hir[e].kind else {
                continue;
            };
            let element = &hir[j];
            let start = hir[e].pos;
            // Where the opening tag ends, which is all there is to an element that closes itself.
            let end = if self.explains {
                self.end_of_jsx_opening(file, e, j)
            } else {
                0
            };
            if jsx == JsxEmit::None {
                out.push(Diagnostic { start, code: 17004 });
                self.note(start, end, 17004, Vec::new());
            }
            if runtime_is_missing && first == Some(e) {
                let code = if runtime_is_no_module { 2306 } else { 2875 };
                out.push(Diagnostic { start, code });
                self.explain_to(start, end, code, |c| {
                    let Some(spec) = runtime else {
                        return Vec::new();
                    };
                    vec![match c.files().module(file).imported_file(spec) {
                        Some(found) if code == 2306 => c.files().module(found).path.clone(),
                        _ => c.atom_text(spec),
                    }]
                });
            }
            // `resolveName`, from the tag outwards. What `checkAndReportErrorForMissingPrefix` says of a tag that is spelled like what is
            // looked for is not said.
            let scope = bound.expr_scope.get(&e).copied().unwrap_or(ScopeId(0));
            let factory_is_missing = checks_factory && is_missing(self, scope, factory);
            if element.tag.is_none() {
                let gives_fragment_type = checks_fragment_type && first_fragment == Some(e);
                let fragment_factory_is_missing = (checks_factory || gives_fragment_type)
                    && names_fragment_factory
                    && is_missing(self, scope, fragment_factory);
                if checks_factory && fragment_factory_is_missing {
                    let code = self.why_no_jsx_factory(file, scope, fragment_factory, 2874);
                    out.push(Diagnostic { start, code });
                    let name = fragment_factory;
                    self.explain_missing_jsx_factory(file, scope, (start, end), code, name);
                }
                if factory_is_missing {
                    let code = self.why_no_jsx_factory(file, scope, factory, 2874);
                    out.push(Diagnostic { start, code });
                    self.explain_missing_jsx_factory(file, scope, (start, end), code, factory);
                }
                if gives_fragment_type && fragment_factory_is_missing {
                    let code = self.why_no_jsx_factory(file, scope, fragment_factory, 2879);
                    out.push(Diagnostic { start, code });
                    let name = fragment_factory;
                    self.explain_missing_jsx_factory(file, scope, (start, end), code, name);
                }
                continue;
            }
            if factory_is_missing {
                let at = (tag_name_start(hir, e), tag_name_end(hir, e));
                let code = self.why_no_jsx_factory(file, scope, factory, 2874);
                out.push(Diagnostic { start: at.0, code });
                self.explain_missing_jsx_factory(file, scope, at, code, factory);
            }
            self.check_jsx_attributes(file, e, out);
            self.check_jsx_children_given_twice(file, e, out);
            self.check_spread_overrides(file, element.attrs, out);
            self.check_jsx_component(file, e, out);
            // `checkJsxElementDeferred`: `getIntrinsicTagSymbol` of the opening element, then of the closing one, each by its own name.
            // A closing name that is not intrinsic is an expression, checked like any other.
            let intrinsic_name = |tag: ExprId| match hir[tag].kind {
                // `IsIntrinsicJsxName`: a missing name is not one.
                ExprKind::String(name) if name != known::empty => Some(name),
                _ => None,
            };
            let opening_name = intrinsic_name(element.tag);
            let closing_name = if element.close_pos == u32::MAX {
                None
            } else if element.close_tag.is_some() {
                intrinsic_name(element.close_tag)
            } else {
                opening_name
            };
            for (name, start, is_closing) in [
                (opening_name, start, false),
                (closing_name, element.close_pos, true),
            ] {
                let Some(name) = name else { continue };
                let code = match intrinsic_elements {
                    None if no_implicit_any => 7026,
                    None => continue,
                    Some(elements)
                        if !self.is_known(elements)
                            || self.type_of_property(elements, name).is_some() =>
                    {
                        continue;
                    }
                    Some(_) => 2339,
                };
                out.push(Diagnostic { start, code });
                let end = if is_closing {
                    self.end_of_jsx_closing(file, j)
                } else {
                    end
                };
                self.explain_to(start, end, code, |c| {
                    if code == 7026 {
                        vec!["IntrinsicElements".to_owned()]
                    } else {
                        vec![c.atom_text(name), "JSX.IntrinsicElements".to_owned()]
                    }
                });
            }
        }
    }

    /// `onFailedToResolveSymbol`: whatever `why_no_jsx_factory` has it say, it says of `name`, which is looked for from `scope` and is
    /// not written where the error is, from `at.0` to `at.1`.
    fn explain_missing_jsx_factory(
        &mut self,
        file: FileId,
        scope: ScopeId,
        at: (u32, u32),
        code: u32,
        name: Atom,
    ) {
        self.explain_to(at.0, at.1, code, |c| {
            let mut arguments = vec![c.atom_text(name)];
            if code == 2552 {
                let meant = super::errors::name_meant(c, file, scope, name, SymFlags::VALUE);
                arguments.push(meant);
            }
            arguments
        });
    }

    /// Notes the name of the tag of `e` as it is written, which is what the error `code` at that name is about.
    fn explain_by_tag_name(&mut self, file: FileId, e: ExprId, code: u32) {
        let hir = self.hir(file);
        let (start, end) = (tag_name_start(hir, e), tag_name_end(hir, e));
        self.explain_to(start, end, code, |c| vec![c.source_text(file, start, end)]);
    }

    /// How many times over `checkNodeDeferred` puts off what `e` is written in. What is put off is looked at after the statements of
    /// the file, in the order it was met, and what is met meanwhile goes last.
    fn jsx_deferral_depth(&mut self, file: FileId, e: ExprId) -> u32 {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut depth = 0;
        // Whether it is part of what the function it is written in returns or yields.
        let mut is_returned = false;
        let mut parent = bound.expr_parent[e.idx()];
        loop {
            let outer = self.outward(file, parent);
            match parent {
                Parent::None | Parent::File => return depth,
                Parent::Expr(x) => match hir[x].kind {
                    // `checkJsxElementDeferred`: what is in an element waits. What is in a fragment does not.
                    ExprKind::Jsx(j) if hir[j].tag.is_some() => depth += 1,
                    // `checkVoidExpression`
                    ExprKind::Unary { op: UnOp::Void, .. } => depth += 1,
                    ExprKind::Yield { .. } => is_returned = true,
                    _ => {}
                },
                Parent::Stmt(s) if s.is_some() && matches!(hir[s].kind, StmtKind::Return(_)) => {
                    is_returned = true
                }
                Parent::FnBody(_) | Parent::ParamDefault(_) | Parent::MemberInit(_) => {
                    if let Parent::Expr(x) = outer {
                        let is_put_off = match hir[x].kind {
                            // `checkClassExpressionDeferred`
                            ExprKind::Class(_) => true,
                            // `checkSignatureDeclaration` sees to the parameters at once. An accessor of an object literal waits as a whole.
                            ExprKind::Fn(f) if matches!(parent, Parent::ParamDefault(_)) => {
                                matches!(hir[f].kind, FnKind::Getter | FnKind::Setter)
                            }
                            // `getReturnTypeFromBody` goes through what is returned as soon as it is asked what the function returns: it is
                            // called on the spot, or it is held against what is expected of it.
                            ExprKind::Fn(f) => {
                                let is_called = matches!(bound.expr_parent[x.idx()], Parent::Expr(p) if matches!(hir[p].kind, ExprKind::Call(c) if hir[c].callee == x));
                                let is_looked_at = (is_returned
                                    || matches!(hir[f].body, FnBody::Expr(_)))
                                    && hir[f].ret.is_none()
                                    && (is_called
                                        || self.contextual_type(file, x).is_some_and(|t| {
                                            t != TypeId::ANY && t != TypeId::UNKNOWN
                                        }));
                                !is_looked_at
                            }
                            _ => false,
                        };
                        depth += u32::from(is_put_off);
                    }
                    is_returned = false;
                }
                _ => {}
            }
            parent = outer;
        }
    }

    /// `resolveJsxOpeningLikeElement` and `checkApplicableSignatureForJsxCallLikeElement`: 2322 and what says more, 2558 2604 2743 2769.
    fn check_jsx_attributes(&mut self, file: FileId, e: ExprId, out: &mut Vec<Diagnostic>) {
        let hir = self.hir(file);
        let ExprKind::Jsx(j) = hir[e].kind else {
            return;
        };
        let jsx = &hir[j];
        let (tag_name, tag_end) = (tag_name_start(hir, e), tag_name_end(hir, e));
        let wanted: Vec<TypeId> = match hir[jsx.tag].kind {
            ExprKind::String(name) => {
                // An intrinsic element takes no type arguments. The attributes are checked all the same.
                self.report_jsx_type_argument_arity(file, jsx.type_args, &[], out);
                match self.jsx_intrinsic_attributes(file, name) {
                    Some(attributes) => vec![attributes],
                    None => return,
                }
            }
            _ => {
                let component = self.type_of_expr(file, jsx.tag);
                if !self.is_known(component)
                    || self.is_any(component)
                    || self.is_uncertain(file, jsx.tag)
                {
                    return;
                }
                // `getUninstantiatedJsxSignaturesOfType`: `string` takes anything (`anySignature`), but no type arguments.
                if component == TypeId::STRING {
                    self.report_jsx_type_argument_arity(file, jsx.type_args, &[], out);
                    return;
                }
                if let Some(name) = self.string_literal_value(component) {
                    // A string literal stands for the element of that name.
                    match self.jsx_attributes_of_literal_tag(file, name) {
                        Ok(Some(_)) => {}
                        Ok(None) => {
                            out.push(Diagnostic {
                                start: hir[e].pos,
                                code: 2339,
                            });
                            let end = self.end_of_jsx_opening(file, e, j);
                            self.explain_to(hir[e].pos, end, 2339, |c| {
                                vec![c.atom_text(name), "JSX.IntrinsicElements".to_owned()]
                            });
                            out.push(Diagnostic {
                                start: tag_name,
                                code: 2604,
                            });
                            self.explain_by_tag_name(file, e, 2604);
                            return;
                        }
                        Err(()) => return,
                    }
                    // `createSignatureForJSXIntrinsic` is not generic, and `chooseOverload` rejects it before it looks at the attributes.
                    if self.report_jsx_type_argument_arity(file, jsx.type_args, &[], out) {
                        return;
                    }
                    // The attributes have to have been read with what they are held against in mind.
                    match self.jsx_props_type(file, e) {
                        Some(props) => vec![props],
                        None => return,
                    }
                } else {
                    let apparent = self.apparent_type(component);
                    // `isUntypedFunctionCall`
                    if !self.is_known(apparent) || self.is_any(apparent) {
                        return;
                    }
                    let (sigs, construct) = self.jsx_signatures(component);
                    if self.is_union(apparent) {
                        // Of what can be several things it is only asked whether it can be a tag at all.
                        let mut said = Vec::new();
                        let at = (hir[e].pos, self.end_of_jsx_opening(file, e, j));
                        if sigs.is_empty()
                            && self.jsx_tag_has_signatures(file, component, at, &mut said)
                                == Some(false)
                        {
                            out.append(&mut said);
                            out.push(Diagnostic {
                                start: tag_name,
                                code: 2604,
                            });
                            self.explain_by_tag_name(file, e, 2604);
                        }
                        return;
                    }
                    if sigs.is_empty() {
                        // `isUntypedFunctionCall`: a `Function` can be called, with whatever.
                        let function = self.global_ref(known::Function, &[]);
                        if self.reduced(apparent) == TypeId::NEVER
                            || !self.is_assignable(component, function)
                        {
                            out.push(Diagnostic {
                                start: tag_name,
                                code: 2604,
                            });
                            self.explain_by_tag_name(file, e, 2604);
                        }
                        return;
                    }
                    // `chooseOverload` skips every signature then, so `reportCallResolutionErrors` has no argument error to report.
                    if self.report_jsx_type_argument_arity(file, jsx.type_args, &sigs, out) {
                        return;
                    }
                    let candidates = self.reorder_candidates(&sigs);
                    if self.report_jsx_type_argument_constraints(
                        file,
                        jsx.type_args,
                        &candidates,
                        out,
                    ) {
                        return;
                    }
                    if sigs.len() == 1 {
                        match self.jsx_props_type(file, e) {
                            Some(props) => vec![props],
                            None => return,
                        }
                    } else {
                        match self.jsx_props_of_each(file, e, &candidates, construct) {
                            Some(wanted) => wanted,
                            None => return,
                        }
                    }
                }
            }
        };
        if wanted.iter().any(|&t| !self.is_known(t)) {
            return;
        }
        // No signature applies then, whatever the attributes are.
        if !matches!(hir[jsx.tag].kind, ExprKind::String(_))
            && let Some((least, factory, most)) = self.jsx_tag_expects_too_many_arguments(file, e)
        {
            out.push(Diagnostic {
                start: tag_name,
                code: if wanted.len() > 1 { 2769 } else { 6229 },
            });
            self.explain_to(tag_name, tag_end, 6229, |c| {
                // `entityNameToString`
                let tag = c.source_text(file, tag_name, tag_end);
                vec![
                    tag.split_whitespace().collect::<String>(),
                    least.to_string(),
                    factory,
                    most.to_string(),
                ]
            });
            // `getSymbolAtLocation(tagName).ValueDeclaration`
            self.relate(tag_name, 6229, |c| {
                let at = match hir[jsx.tag].kind {
                    ExprKind::Ident(name) => c
                        .symbol_of_identifier(file, jsx.tag, name)
                        .filter(|&sym| c.files().flags(sym).intersects(SymFlags::VALUE))
                        .and_then(|sym| c.place_of_symbol(sym)),
                    ExprKind::Dot { obj, name, .. } => {
                        let object = c.type_of_expr(file, obj);
                        let object = c.apparent_type(object);
                        let prop = c.prop_ref(object, name);
                        prop.and_then(|(prop, _)| c.place_of_prop(prop))
                    }
                    _ => None,
                };
                let tag = c.source_text(file, tag_name, tag_end);
                let tag = tag.split_whitespace().collect::<String>();
                at.map(|at| c.declared_here(at, tag)).into_iter().collect()
            });
            if wanted.len() > 1 {
                self.explain_under(tag_name, 6229, 2770, Vec::new());
                self.explain_under(tag_name, 2770, 2769, Vec::new());
            }
            return;
        }
        // Nothing is said on the strength of what is not known.
        for p in jsx.attrs.iter() {
            let ty = if hir[p].kind == PropKind::Spread {
                self.type_of_expr(file, hir[p].value)
            } else {
                self.type_of_literal_prop(file, p)
            };
            if !self.is_known(ty) || hir[p].value.is_some() && self.is_uncertain(file, hir[p].value)
            {
                return;
            }
        }
        let given = self.jsx_attributes_type(file, e);
        let counts_children = matches!(self.jsx_children_property_name(file), JsxName::Name(_));
        if !self.is_known(given)
            || self.is_any(given)
            || counts_children
                && self
                    .jsx_child_types(file, e)
                    .iter()
                    .any(|c| !self.is_known(c.1))
        {
            return;
        }
        if wanted.iter().any(|&props| self.is_assignable(given, props)) {
            return;
        }
        // Of several signatures, what is wrong with the last is what is said.
        let Some(&props) = wanted.last() else { return };
        let mut said = Vec::new();
        if !self.elaborate_jsx_components(file, e, given, props, &mut said) {
            self.report_not_assignable_with_end(given, props, tag_name, tag_end, 2322, &mut said);
        }
        if wanted.len() > 1 {
            for d in &mut said {
                self.explain_under(d.start, d.code, 2770, Vec::new());
                self.explain_under(d.start, 2770, 2769, Vec::new());
                d.code = 2769;
            }
        }
        out.append(&mut said);
    }

    /// `getTypeArgumentArityError`: reports 2558 or 2743 at `type_args`, the type arguments of an element, unless one of `sigs`, the
    /// signatures of its tag, has the correct arity (`hasCorrectTypeArgumentArity`). Returns whether it reported.
    fn report_jsx_type_argument_arity(
        &mut self,
        file: FileId,
        type_args: IdList<TypeNodeId>,
        sigs: &[SigId],
        out: &mut Vec<Diagnostic>,
    ) -> bool {
        let hir = self.hir(file);
        let Some(first) = hir.ids(type_args).next() else {
            return false;
        };
        let count = type_args.len();
        let (mut takes_fewer, mut needs_more) = (false, false);
        for &sig in sigs {
            let type_params = self.sig_type_params(sig);
            if self.has_correct_type_argument_arity(&type_params, count) {
                return false;
            }
            if self.min_type_argument_count(&type_params) > count {
                needs_more = true;
            } else {
                takes_fewer = true;
            }
        }
        let start = hir[first].pos;
        let code = if takes_fewer && needs_more {
            2743
        } else {
            2558
        };
        out.push(Diagnostic { start, code });
        let end = self.end_of_type_args(file, type_args);
        self.explain_to(start, end, code, |c| {
            let mut range = "0".to_owned();
            let (mut below, mut above) = (None::<usize>, None::<usize>);
            for &sig in sigs {
                let type_params = c.sig_type_params(sig);
                let (least, most) = (c.min_type_argument_count(&type_params), type_params.len());
                range = if least < most {
                    format!("{least}-{most}")
                } else {
                    least.to_string()
                };
                if least > count {
                    above = Some(above.map_or(least, |above| above.min(least)));
                } else if most < count {
                    below = Some(below.map_or(most, |below| below.max(most)));
                }
            }
            match (below, above) {
                _ if sigs.len() < 2 => vec![range, count.to_string()],
                (Some(below), Some(above)) => {
                    vec![count.to_string(), below.to_string(), above.to_string()]
                }
                _ => vec![below.or(above).unwrap_or(0).to_string(), count.to_string()],
            }
        });
        true
    }

    /// `chooseOverload` skips a candidate whose constraints the type arguments violate (`checkTypeArguments`). If that leaves none of
    /// `candidates`, reports 2344 for the last one skipped (`candidateForTypeArgumentError`). Returns whether it reported.
    fn report_jsx_type_argument_constraints(
        &mut self,
        file: FileId,
        type_args: IdList<TypeNodeId>,
        candidates: &[SigId],
        out: &mut Vec<Diagnostic>,
    ) -> bool {
        if type_args.is_empty() {
            return false;
        }
        let given = self.types_from_nodes(file, type_args);
        if given.iter().any(|&t| !self.is_known(t)) {
            return false;
        }
        let mut violation = None;
        for &candidate in candidates {
            let type_params = self.sig_type_params(candidate);
            if !self.has_correct_type_argument_arity(&type_params, given.len()) {
                continue;
            }
            match self.failing_type_argument(candidate, &type_params, &given) {
                Ok(Some(found)) => violation = Some(found),
                Ok(None) | Err(()) => return false,
            }
        }
        let Some((index, argument, constraint)) = violation else {
            return false;
        };
        let hir = self.hir(file);
        let node = hir.id_at(type_args, index);
        self.report_not_assignable_with_end(
            argument,
            constraint,
            hir[node].pos,
            self.end_of_type_node(file, node),
            2344,
            out,
        );
        true
    }

    /// `checkTagNameDoesNotExpectTooManyArguments`: whether every way to call the tag of `e` wants more arguments than what elements are
    /// made with passes to a function it is given. If so: the fewest it wants, what elements are made with, and the most that passes.
    fn jsx_tag_expects_too_many_arguments(
        &mut self,
        file: FileId,
        e: ExprId,
    ) -> Option<(usize, String, usize)> {
        let (hir, files) = (self.hir(file), self.files());
        let ExprKind::Jsx(j) = hir[e].kind else {
            return None;
        };
        // What is imported unasked is taken to fit.
        if files
            .jsx_runtime(file)
            .is_some_and(|spec| files.module_of_specifier(file, spec).is_some())
        {
            return None;
        }
        // `getSignaturesOfType`, which does not look at what a type parameter extends.
        let tag_type = self.type_of_expr(file, hir[j].tag);
        if self.is_deferred(tag_type) {
            return None;
        }
        let ways = self.signatures(tag_type, false);
        if ways.is_empty() {
            return None;
        }
        // `getJsxFactoryEntity`: `@jsx` if it parses, else `jsxFactory` if it parses, else `<_jsxNamespace>.createElement`.
        let (options, atoms) = (&files.options, &files.atoms);
        let jsx_pragma = hir.jsx_pragmas.factory;
        let local_factory = if jsx_pragma.is_some() {
            parse_isolated_entity_name(atoms.bytes(jsx_pragma))
        } else {
            None
        };
        let names: Vec<Atom> = match local_factory
            .or_else(|| parse_isolated_entity_name(options.jsx_factory.as_bytes()))
        {
            Some(entity) => entity_name_parts(entity)
                .map(|name| atoms.intern_str(name))
                .collect(),
            None => {
                // `reactNamespace` is read only if no `jsxFactory` is written.
                let reads_react_namespace =
                    options.jsx_factory.is_empty() && !options.react_namespace.is_empty();
                let namespace = if reads_react_namespace {
                    atoms.intern_str(&options.react_namespace)
                } else {
                    known::React
                };
                vec![namespace, atoms.intern(b"createElement")]
            }
        };
        let scope = self
            .bound(file)
            .expr_scope
            .get(&e)
            .copied()
            .unwrap_or(ScopeId(0));
        let factory = files
            .resolve_entity(file, scope, &names, SymFlags::VALUE)
            .and_then(|found| files.resolve_alias_if_needed(found));
        let factory_type = self.type_of_symbol(factory?);
        // The most that any function taken as the first argument is called with. `None`: no function is taken there.
        let mut most: Option<usize> = None;
        for sig in self.signatures(factory_type, false) {
            let params = self.sig_params(sig);
            let first = self.param_type_at(&params, 0).unwrap_or(TypeId::ANY);
            if !self.is_known(first) {
                return None;
            }
            for taken in self.signatures(first, false) {
                let params = self.sig_params(taken);
                if self.has_effective_rest_parameter(&params) {
                    return None;
                }
                most = Some(most.unwrap_or(0).max(self.parameter_count(&params)));
            }
        }
        let most = most?;
        let mut least = usize::MAX;
        for sig in ways {
            let params = self.sig_params(sig);
            least = least.min(self.min_argument_count(&params));
        }
        if least <= most {
            return None;
        }
        let factory: Vec<String> = names.iter().map(|&name| self.atom_text(name)).collect();
        Some((least, factory.join("."), most))
    }

    /// Whether `getUninstantiatedJsxSignaturesOfType` finds any for `ty`. Of each string literal in it that names no element 2339 is
    /// said, from `at.0` to `at.1`. `None`: it cannot be told.
    fn jsx_tag_has_signatures(
        &mut self,
        file: FileId,
        ty: TypeId,
        at: (u32, u32),
        out: &mut Vec<Diagnostic>,
    ) -> Option<bool> {
        if ty == TypeId::STRING {
            return Some(true);
        }
        if let Some(name) = self.string_literal_value(ty) {
            let names_element = !matches!(self.jsx_attributes_of_literal_tag(file, name), Ok(None));
            if !names_element {
                out.push(Diagnostic {
                    start: at.0,
                    code: 2339,
                });
                self.explain_to(at.0, at.1, 2339, |c| {
                    vec![c.atom_text(name), "JSX.IntrinsicElements".to_owned()]
                });
            }
            return Some(names_element);
        }
        let apparent = self.apparent_type(ty);
        if !self.is_known(apparent) {
            return None;
        }
        if !self.jsx_signatures(ty).0.is_empty() {
            return Some(true);
        }
        if !self.is_union(apparent) {
            return Some(false);
        }
        // `getUnionSignatures`: none as soon as one member has none. Every member is asked first.
        let mut all = true;
        for &part in self.parts(apparent) {
            all &= self.jsx_tag_has_signatures(file, part, at, out)?;
        }
        // Whether what they have goes together is not worked out.
        if all { None } else { Some(false) }
    }

    /// `elaborateJsxComponents`
    fn elaborate_jsx_components(
        &mut self,
        file: FileId,
        e: ExprId,
        source: TypeId,
        target: TypeId,
        out: &mut Vec<Diagnostic>,
    ) -> bool {
        let hir = self.hir(file);
        let ExprKind::Jsx(j) = hir[e].kind else {
            return false;
        };
        let mut reported = false;
        for p in hir[j].attrs.iter() {
            let prop = &hir[p];
            if prop.kind == PropKind::Spread {
                continue;
            }
            let Some(name) = self.member_name(file, prop.key) else {
                continue;
            };
            if self.files().atoms.bytes(name).contains(&b'-') {
                continue;
            }
            let said = out.len();
            let end = self.end_of_jsx_attr_name(file, p);
            reported |= self.elaborate_element_with_end(
                file, source, target, prop.pos, end, prop.value, name, 2322, out,
            );
            // `elaborateDidYouMeanToCallOrConstruct` is asked of the braces around the value before it is asked of the value: what it
            // says, which is all that is said where the value starts, is said where they start.
            if prop.value.is_some() && out.len() > said {
                let value = self.start_of(file, prop.value);
                if let Some(brace) = brace_before(hir, value, false) {
                    for d in &mut out[said..] {
                        if d.start == value {
                            let end = self.end_of_bracket_at(file, brace);
                            self.explain_moved(value, d.code, brace, end);
                            d.start = brace;
                        }
                    }
                }
            }
        }
        let children = self.jsx_child_types(file, e);
        if children.is_empty() {
            return reported;
        }
        let name = match self.jsx_children_property_name(file) {
            JsxName::Name(name) => name,
            JsxName::Missing => known::children,
            JsxName::Empty => return reported,
        };
        let Some(wanted) = self.type_of_property(target, name) else {
            return reported;
        };
        if !self.is_known(wanted) {
            return reported;
        }
        // Where there is no `Iterable`, a list is what is like an array or a tuple.
        let has_iterable = self.global_type_symbol(known::Iterable).is_some();
        let any_iterable = self.global_ref(
            known::Iterable,
            &[TypeId::ANY, TypeId::VOID, TypeId::UNDEFINED],
        );
        let is_list = |c: &mut Self, m: TypeId| {
            if has_iterable {
                c.is_assignable(m, any_iterable)
            } else {
                c.is_array_like(m) || c.is_tuple_like(m)
            }
        };
        let lists = self.filter(wanted, |c, m| is_list(c, m));
        let others = self.filter(wanted, |c, m| !is_list(c, m));
        // What is not there is `unknown`.
        let is_related = |c: &mut Self| {
            let given = c.type_of_property(source, name).unwrap_or(TypeId::UNKNOWN);
            c.is_assignable(given, wanted)
        };
        let (tag_name, tag_end) = (tag_name_start(hir, e), tag_name_end(hir, e));
        if children.len() > 1 {
            if lists != TypeId::NEVER {
                reported |=
                    self.elaborate_jsx_children(file, e, &children, lists, (name, wanted), out);
            } else if !is_related(self) {
                out.push(Diagnostic {
                    start: tag_name,
                    code: 2746,
                });
                self.explain_to(tag_name, tag_end, 2746, |c| {
                    vec![c.atom_text(name), c.type_to_string(wanted)]
                });
                reported = true;
            }
        } else if others != TypeId::NEVER {
            // `getElaborationElementForJsxChild`
            let (child, _) = children[0];
            let Some(at) = self.jsx_child_start(file, e, &children, 0) else {
                return reported;
            };
            if is_jsx_text(hir, e, child) {
                // `elaborateElement`, with nothing to go into: whatever is wrong with text, the same is said of it.
                let is_generic = self.is_generic_object_type(target)
                    || matches!(self.data(wanted), TypeData::IndexedAccess { .. });
                if !is_generic && self.type_of_property(source, name).is_some() && !is_related(self)
                {
                    out.push(Diagnostic {
                        start: at,
                        code: 2747,
                    });
                    self.explain_jsx_text_child(file, e, at, (name, wanted));
                    reported = true;
                }
            } else {
                let inner = match hir[child].kind {
                    ExprKind::Spread(x) => x,
                    _ => child,
                };
                let end = self.jsx_child_end(file, child, at);
                reported |= self.elaborate_element_with_end(
                    file, source, target, at, end, inner, name, 2322, out,
                );
            }
        } else if !is_related(self) {
            out.push(Diagnostic {
                start: tag_name,
                code: 2745,
            });
            self.explain_to(tag_name, tag_end, 2745, |c| {
                vec![c.atom_text(name), c.type_to_string(wanted)]
            });
            reported = true;
        }
        reported
    }

    /// `getInvalidTextualChildDiagnostic`: notes what 2747 says of the text that starts at `at` in the element `e`.
    /// `expected`: the name the children go by, and what the tag takes under that name.
    fn explain_jsx_text_child(
        &mut self,
        file: FileId,
        e: ExprId,
        at: u32,
        expected: (Atom, TypeId),
    ) {
        let hir = self.hir(file);
        let (tag_name, tag_end) = (tag_name_start(hir, e), tag_name_end(hir, e));
        self.explain_to(at, jsx_text_end(hir, at), 2747, |c| {
            vec![
                c.source_text(file, tag_name, tag_end),
                c.atom_text(expected.0),
                c.type_to_string(expected.1),
            ]
        });
    }

    /// `elaborateIterableOrArrayLikeTargetElementwise` over `generateJsxChildren`: each of the `children` of `e` is held against what
    /// `target`, a list, has for it. `{}`, which counts there for the numbering, is not kept and does not count here.
    /// `expected`: the name the children go by, and all that the tag takes under that name.
    fn elaborate_jsx_children(
        &mut self,
        file: FileId,
        e: ExprId,
        children: &[(ExprId, TypeId)],
        target: TypeId,
        expected: (Atom, TypeId),
        out: &mut Vec<Diagnostic>,
    ) -> bool {
        let hir = self.hir(file);
        // `isArrayOrTupleLikeType`
        let arrays = self.filter(target, |c, m| c.is_array_like(m) || c.is_tuple_like(m));
        let iterables = self.filter(target, |c, m| !(c.is_array_like(m) || c.is_tuple_like(m)));
        let yielded = if iterables != TypeId::NEVER {
            Some(self.iterated_type(iterables, false))
        } else {
            None
        };
        let types: Vec<TypeId> = children.iter().map(|c| c.1).collect();
        let source = self.tuple(&types, &vec![ElemFlags::REQUIRED; types.len()], false);
        let mut said = Vec::new();
        for (i, &(child, given)) in children.iter().enumerate() {
            let key = self.number_literal(i as f64, false);
            // `getBestMatchIndexedAccessTypeOrUndefined`
            let mut indexed = None;
            if arrays != TypeId::NEVER {
                indexed = self.indexed_access_if_any(arrays, key, false);
                if indexed.is_none()
                    && self.is_union(arrays)
                    && let Some(best) = self.best_matching_type(source, arrays)
                {
                    indexed = self.indexed_access_if_any(best, key, false);
                }
            }
            let indexed =
                indexed.filter(|&t| !matches!(self.data(t), TypeData::IndexedAccess { .. }));
            let wanted = match (yielded, indexed) {
                (Some(a), Some(b)) => self.union(&[a, b]),
                (Some(a), None) | (None, Some(a)) => a,
                (None, None) => continue,
            };
            if !self.is_known(wanted) || !self.is_known(given) || self.is_assignable(given, wanted)
            {
                continue;
            }
            // Where a child cannot be pointed at, the tag is.
            let Some(at) = self.jsx_child_start(file, e, children, i) else {
                return false;
            };
            if is_jsx_text(hir, e, child) {
                said.push(Diagnostic {
                    start: at,
                    code: 2747,
                });
                self.explain_jsx_text_child(file, e, at, expected);
                continue;
            }
            let inner = match hir[child].kind {
                ExprKind::Spread(x) => x,
                _ => child,
            };
            if !self.elaborate(file, inner, given, wanted, 2322, &mut said) {
                let end = self.jsx_child_end(file, child, at);
                self.report_not_assignable_with_end(given, wanted, at, end, 2322, &mut said);
            }
        }
        let reported = !said.is_empty();
        out.append(&mut said);
        reported
    }

    /// Where the error node that `getElaborationElementForJsxChild` gives for child `i` of `e` starts. `None`: the text does not tell.
    fn jsx_child_start(
        &self,
        file: FileId,
        e: ExprId,
        children: &[(ExprId, TypeId)],
        i: usize,
    ) -> Option<u32> {
        let hir = self.hir(file);
        let ExprKind::Jsx(j) = hir[e].kind else {
            return None;
        };
        let child = children[i].0;
        if !is_jsx_text(hir, e, child) {
            let (inner, is_spread) = match hir[child].kind {
                ExprKind::Spread(x) => (x, true),
                _ => (child, false),
            };
            // `{ x }`: the brace. An element that is written bare: its `<`.
            return match brace_before(hir, self.start_of(file, inner), is_spread) {
                None if matches!(hir[child].kind, ExprKind::Jsx(_)) => Some(hir[child].pos),
                brace => brace,
            };
        }
        // Text goes from the end of what comes before it, white space and all, to where what follows it starts.
        let mut end = match children.get(i + 1) {
            Some(_) => self.jsx_child_start(file, e, children, i + 1)?,
            None if hir[j].close_pos == u32::MAX => return None,
            None => hir[j].close_pos,
        };
        loop {
            let before = hir.text.get(..end as usize)?;
            let start = before.iter().rposition(|&c| c == b'>' || c == b'}')? + 1;
            if !before[start..].trim_ascii().is_empty() {
                return Some(start as u32);
            }
            // `{}` is not kept: the text is before it.
            let inside = trim_trivia_end(&before[..start - 1]);
            if before[start - 1] != b'}' || !inside.ends_with(b"{") {
                return None;
            }
            end = inside.len() as u32 - 1;
        }
    }

    /// Where that node ends, for a `child` that is not text and starts at `at`: `{ x }`, or an element that is written bare.
    fn jsx_child_end(&self, file: FileId, child: ExprId, at: u32) -> u32 {
        if self.hir(file).text.get(at as usize) == Some(&b'{') {
            self.end_of_bracket_at(file, at)
        } else {
            self.end_of_expr(file, child)
        }
    }

    /// `createJsxAttributesTypeFromAttributesProperty`: 2710, an attribute by the name the children go by, next to children.
    fn check_jsx_children_given_twice(
        &mut self,
        file: FileId,
        e: ExprId,
        out: &mut Vec<Diagnostic>,
    ) {
        let hir = self.hir(file);
        let ExprKind::Jsx(j) = hir[e].kind else {
            return;
        };
        let jsx = &hir[j];
        let Some(first) = jsx.attrs.iter().next() else {
            return;
        };
        if !hir
            .ids(jsx.children)
            .any(|child| !matches!(hir[child].kind, ExprKind::Missing))
        {
            return;
        }
        let JsxName::Name(name) = self.jsx_children_property_name(file) else {
            return;
        };
        let mut is_given = false;
        for p in jsx.attrs.iter() {
            let prop = &hir[p];
            if prop.kind != PropKind::Spread {
                is_given |= self.member_name(file, prop.key) == Some(name);
                continue;
            }
            // `hasSpreadAnyType`
            let ty = self.type_of_expr(file, prop.value);
            let ty = self.reduced(ty);
            if self.is_any(ty) {
                return;
            }
        }
        if !is_given {
            return;
        }
        // It is said of the attributes together, which start where the first does.
        let start = match hir[first].kind {
            PropKind::Spread => brace_before(hir, self.start_of(file, hir[first].value), true),
            _ => Some(hir[first].pos),
        };
        if let Some(start) = start {
            out.push(Diagnostic { start, code: 2710 });
            let end = match jsx.attrs.iter().next_back() {
                Some(last) => self.end_of_jsx_attr(file, last),
                None => 0,
            };
            self.explain_to(start, end, 2710, |c| vec![c.atom_text(name)]);
        }
    }

    /// `checkSpreadPropOverrides`: 2783, what is written only to be overwritten by what is spread after it.
    pub(super) fn check_spread_overrides(
        &mut self,
        file: FileId,
        props: Span<PropId>,
        out: &mut Vec<Diagnostic>,
    ) {
        let hir = self.hir(file);
        if !self.p.files.options.strict_null_checks
            || !props.iter().any(|p| hir[p].kind == PropKind::Spread)
        {
            return;
        }
        // `allPropertiesTable`, which accessors are not put in.
        let mut written: Vec<(Atom, PropId)> = Vec::new();
        for p in props.iter() {
            let prop = &hir[p];
            if prop.kind != PropKind::Spread {
                if matches!(
                    prop.kind,
                    PropKind::Init | PropKind::Shorthand | PropKind::Method
                ) && let Some(name) = self.member_name(file, prop.key)
                {
                    written.retain(|w| w.0 != name);
                    written.push((name, p));
                }
                continue;
            }
            if written.is_empty() {
                continue;
            }
            let ty = self.type_of_expr(file, prop.value);
            let ty = self.reduced(ty);
            if !self.is_known(ty) || self.is_any(ty) || !self.is_valid_spread_type(ty) {
                continue;
            }
            // `tryMergeUnionOfObjectTypeAndEmptyObject`
            let merged = self.merge_object_or_nothing(ty);
            let parts = self.parts(merged);
            for &(name, overwritten) in &written {
                // Neither optional nor partial: every alternative is sure to have it.
                let mut always = !parts.is_empty();
                for &part in parts {
                    let apparent = self.apparent_type(part);
                    for &alternative in self.parts(apparent) {
                        always = always
                            && self
                                .prop_of(alternative, name)
                                .is_some_and(|(p, _)| !p.flags.contains(PropFlags::OPTIONAL));
                    }
                }
                if always {
                    let start = hir[overwritten].pos;
                    // Errors that differ in nothing but what they are related to are made one: `compactAndMergeRelatedInfos`.
                    let is_said = out.iter().any(|d| d.start == start && d.code == 2783);
                    out.push(Diagnostic { start, code: 2783 });
                    // `GetErrorRangeForNode`: a method is pointed at by its name, anything else as a whole.
                    let owner = self.bound(file).prop_owner[overwritten.idx()];
                    let end = if owner.is_some() && matches!(hir[owner].kind, ExprKind::Jsx(_)) {
                        self.end_of_jsx_attr(file, overwritten)
                    } else if hir[overwritten].kind == PropKind::Method {
                        self.end_of_prop_name(file, overwritten)
                    } else {
                        self.end_of_prop(file, overwritten)
                    };
                    if !is_said {
                        self.explain_to(start, end, 2783, |c| vec![c.atom_text(name)]);
                    }
                    self.relate(start, 2783, |c| {
                        // The spread starts at its `...`, that of an attribute at the `{`.
                        let value = c.start_of(file, prop.value);
                        let from = if owner.is_some() && matches!(hir[owner].kind, ExprKind::Jsx(_))
                        {
                            brace_before(hir, value, true)
                        } else {
                            dots_before(hir, value)
                        };
                        vec![super::explain::Related {
                            at: Some((file, from.unwrap_or(value), c.end_of_prop(file, p))),
                            code: 2785,
                            args: Vec::new(),
                        }]
                    });
                }
            }
        }
    }

    /// 2786: what the tag stands for has to be something an element can be made of.
    fn check_jsx_component(&mut self, file: FileId, e: ExprId, out: &mut Vec<Diagnostic>) {
        let hir = self.hir(file);
        let ExprKind::Jsx(j) = hir[e].kind else {
            return;
        };
        let tag = hir[j].tag;
        let tag_name = tag_name_start(hir, e);
        let intrinsic = match hir[tag].kind {
            ExprKind::String(name) => Some(name),
            _ => None,
        };
        // `JSX.ElementType` says it all, if it is there.
        if let Some(allowed) = self.jsx_element_type_constraint(file) {
            let given = match intrinsic {
                Some(name) => self.string_literal(name, false),
                None => self.type_of_expr(file, tag),
            };
            if self.is_known(allowed) && self.is_known(given) && !self.is_assignable(given, allowed)
            {
                out.push(Diagnostic {
                    start: tag_name,
                    code: 2786,
                });
                self.explain_unusable_jsx_component(file, e, given, allowed, 18053);
            }
            return;
        }
        if intrinsic.is_some() {
            return;
        }
        // `checkJsxReturnAssignableToAppropriateBound`
        let component = self.type_of_expr(file, tag);
        if !self.is_known(component) || self.is_any(component) || self.is_uncertain(file, tag) {
            return;
        }
        let of_function = |c: &mut Self| {
            c.jsx_type(file, known::Element)
                .map(|element| c.union(&[element, TypeId::NULL]))
        };
        // `getJsxReferenceKind`
        let (sigs, construct) = self.jsx_signatures(component);
        let (made, bound, head) = if !sigs.is_empty() {
            let Some(made) = self.jsx_resolved_return_type(file, e, &sigs, construct) else {
                return;
            };
            (
                made,
                if construct {
                    self.jsx_type(file, known::ElementClass)
                } else {
                    of_function(self)
                },
                if construct { 2788 } else { 2787 },
            )
        } else {
            // `getUnionSignatures` of what each alternative has, one signature each: it gives back what any of them does.
            let apparent = self.apparent_type(component);
            if !self.is_union(apparent) {
                return;
            }
            let (mut made, mut generic) = (Vec::new(), 0);
            for &part in self.parts(apparent) {
                let (sigs, construct) = self.jsx_signatures(part);
                let [sig] = sigs[..] else { return };
                generic += usize::from(!self.sig_type_params(sig).is_empty());
                let Some(returned) = self.jsx_resolved_return_type(file, e, &sigs, construct)
                else {
                    return;
                };
                made.push(returned);
            }
            // Type parameters on more than one side have to be the same to go together.
            if generic > 1 {
                return;
            }
            // `JsxReferenceKindMixed`: only if there are both.
            let (Some(function), Some(class)) =
                (of_function(self), self.jsx_type(file, known::ElementClass))
            else {
                return;
            };
            (
                self.union(&made),
                Some(self.union(&[function, class])),
                2789,
            )
        };
        if let Some(bound) = bound
            && self.is_known(made)
            && self.is_known(bound)
            && !self.is_assignable(made, bound)
        {
            out.push(Diagnostic {
                start: tag_name,
                code: 2786,
            });
            self.explain_unusable_jsx_component(file, e, made, bound, head);
        }
    }

    /// Notes what 2786 says at the name of the tag of `e`. It goes on top of `head`, which says that `source` is not the `target` an
    /// element can be made of, and of the reasons for that.
    fn explain_unusable_jsx_component(
        &mut self,
        file: FileId,
        e: ExprId,
        source: TypeId,
        target: TypeId,
        head: u32,
    ) {
        if !self.explains {
            return;
        }
        let hir = self.hir(file);
        let (start, end) = (tag_name_start(hir, e), tag_name_end(hir, e));
        let name = vec![self.source_text(file, start, end)];
        let mut said = Vec::new();
        self.report_not_assignable_with_end(source, target, start, end, head, &mut said);
        match said.first() {
            Some(first) if first.start == start => {
                self.explain_under(start, first.code, 2786, name)
            }
            _ => self.note(start, end, 2786, name),
        }
    }

    /// What the signature `getResolvedSignature` settles on for the element `e` returns: of `sigs` the first that takes the attributes,
    /// or what `getCandidateForOverloadFailure` makes up. The round of `chooseOverload` that wants subtypes and
    /// `hasCorrectTypeArgumentArity` are left out. `None`: it cannot be told.
    fn jsx_resolved_return_type(
        &mut self,
        file: FileId,
        e: ExprId,
        sigs: &[SigId],
        construct: bool,
    ) -> Option<TypeId> {
        let hir = self.hir(file);
        let ExprKind::Jsx(j) = hir[e].kind else {
            return None;
        };
        let candidates = self.reorder_candidates(sigs);
        // Asked first: it asks what the element takes, which is the question that is opened next.
        let given = if candidates.len() > 1 {
            self.jsx_attributes_type(file, e)
        } else {
            TypeId::ANY
        };
        if !self.is_known(given) {
            return None;
        }
        // Part of the question what the element takes, as in `jsx_props_of_each`: what is found out about the attributes with type
        // parameters still open is not kept.
        if !self.enter(Query::Call(file, e)) {
            return None;
        }
        let instantiated: Option<Vec<SigId>> = candidates
            .iter()
            .map(|&sig| self.jsx_instantiated_sig(file, e, sig, construct))
            .collect();
        self.leave();
        let instantiated = instantiated?;
        if let [only] = instantiated[..] {
            return Some(self.sig_return(only));
        }
        // `chooseOverload`
        for &sig in &instantiated {
            let props = self.jsx_effective_first_argument(file, e, sig, construct);
            if !self.is_known(props) {
                return None;
            }
            if self.is_assignable(given, props) {
                return Some(self.sig_return(sig));
            }
        }
        let mut is_generic = false;
        for &sig in &candidates {
            is_generic |= !self.sig_type_params(sig).is_empty();
        }
        if is_generic {
            // `getLongestCandidateIndex`: the attributes and the children are one argument, if there are any.
            let count = usize::from(!hir[j].attrs.is_empty() || !hir[j].children.is_empty());
            let (mut best, mut most): (usize, Option<usize>) = (0, None);
            for (i, &sig) in candidates.iter().enumerate() {
                let params = self.sig_params(sig);
                let length = self.parameter_count(&params);
                if self.has_effective_rest_parameter(&params) || length >= count {
                    best = i;
                    break;
                }
                if most.is_none_or(|most| length > most) {
                    (best, most) = (i, Some(length));
                }
            }
            return Some(self.sig_return(instantiated[best]));
        }
        // `createUnionOfSignaturesForOverloadFailure`
        let mut all = Vec::with_capacity(instantiated.len());
        for &sig in &instantiated {
            all.push(self.sig_return(sig));
        }
        Some(self.intersection(&all))
    }
}

/// `getJsxNamespace`: the identifier that an element of the file `hir` needs in scope, and the one that a fragment needs.
pub(super) fn jsx_factory_names(files: &Files, hir: &hir::File) -> (Atom, Atom) {
    let (options, atoms) = (&files.options, &files.atoms);
    // `GetFirstIdentifier` of `parseIsolatedEntityName(text)`
    let first_identifier = |text: &[u8]| -> Option<Atom> {
        let name = entity_name_parts(parse_isolated_entity_name(text)?).next()?;
        Some(atoms.intern_str(name))
    };
    // `_jsxNamespace`: a `jsxFactory` that does not parse leaves `React`. `reactNamespace` is read only if no `jsxFactory` is written,
    // and is used whole.
    let global_factory = if !options.jsx_factory.is_empty() {
        first_identifier(options.jsx_factory.as_bytes()).unwrap_or(known::React)
    } else if !options.react_namespace.is_empty() {
        atoms.intern_str(&options.react_namespace)
    } else {
        known::React
    };
    let (jsx_pragma, jsx_frag_pragma) = (hir.jsx_pragmas.factory, hir.jsx_pragmas.fragment_factory);
    // `getLocalJsxNamespace`: `@jsx` applies to elements only, and is ignored if it does not parse.
    let local_factory = if jsx_pragma.is_some() {
        first_identifier(atoms.bytes(jsx_pragma))
    } else {
        None
    };
    // `getJsxFragmentFactoryEntity`: a `@jsxFrag` pragma hides `jsxFragmentFactory` even if the pragma does not parse.
    let fragment_entity = if jsx_frag_pragma.is_some() {
        atoms.bytes(jsx_frag_pragma)
    } else {
        options.jsx_fragment_factory.as_bytes()
    };
    (
        local_factory.unwrap_or(global_factory),
        first_identifier(fragment_entity).unwrap_or(global_factory),
    )
}

/// `parseIsolatedEntityName`: `text` if it is an identifier or a qualified name. The empty text is neither.
fn parse_isolated_entity_name(text: &[u8]) -> Option<&str> {
    std::str::from_utf8(text)
        .ok()
        .filter(|entity| crate::verify::is_entity_name(entity))
}

/// The identifiers of a parsed entity name, from left to right.
fn entity_name_parts(entity: &str) -> impl Iterator<Item = &str> {
    entity.split('.').map(str::trim)
}

/// Where the name in the opening tag of the element `e` starts.
fn tag_name_start(hir: &hir::File, e: ExprId) -> u32 {
    skip_trivia(&hir.text, hir[e].pos as usize + 1) as u32
}

/// Where it ends.
fn tag_name_end(hir: &hir::File, e: ExprId) -> u32 {
    jsx_name_end(&hir.text, tag_name_start(hir, e))
}

/// `parseJsxElementName`: where the name of a tag that starts at `start` ends. `a-b`, `a:b`, `a.b.c`.
pub(super) fn jsx_name_end(text: &[u8], start: u32) -> u32 {
    let end_of_word = |mut at: usize| {
        while text.get(at).is_some_and(|&c| {
            c.is_ascii_alphanumeric() || matches!(c, b'_' | b'$' | b'-') || c >= 0x80
        }) {
            at += 1;
        }
        at
    };
    let mut end = end_of_word(start as usize);
    loop {
        let separator = skip_trivia(text, end);
        if !matches!(text.get(separator), Some(b'.' | b':')) {
            return end as u32;
        }
        let word = skip_trivia(text, separator + 1);
        let next = end_of_word(word);
        if next == word {
            return end as u32;
        }
        end = next;
    }
}

/// Where the text among the children of an element that starts at `start` ends: at the next `{` or `<`.
fn jsx_text_end(hir: &hir::File, start: u32) -> u32 {
    let rest = hir.text.get(start as usize..).unwrap_or_default();
    let length = rest
        .iter()
        .position(|&c| c == b'{' || c == b'<')
        .unwrap_or(rest.len());
    start + length as u32
}

/// Whether `child` of the element `e` is text. Text is kept as a string that is where the element it is in starts, which a string in
/// braces is not.
fn is_jsx_text(hir: &hir::File, e: ExprId, child: ExprId) -> bool {
    matches!(hir[child].kind, ExprKind::String(_)) && hir[child].pos == hir[e].pos
}

/// Where the `{` of `{x}`, or of `{...x}`, is, given where `x` starts.
fn brace_before(hir: &hir::File, start: u32, is_spread: bool) -> Option<u32> {
    let mut before = trim_trivia_end(hir.text.get(..start as usize)?);
    if is_spread {
        before = trim_trivia_end(before.strip_suffix(b"...")?);
    }
    before.ends_with(b"{").then(|| before.len() as u32 - 1)
}

/// Where the `...` before what starts at `start` is.
fn dots_before(hir: &hir::File, start: u32) -> Option<u32> {
    let before = trim_trivia_end(hir.text.get(..start as usize)?);
    before.ends_with(b"...").then(|| before.len() as u32 - 3)
}

/// `SkipTrivia`: past white space and comments.
fn skip_trivia(text: &[u8], mut at: usize) -> usize {
    loop {
        match text.get(at) {
            Some(c) if c.is_ascii_whitespace() => at += 1,
            Some(b'/') if text.get(at + 1) == Some(&b'/') => {
                while text.get(at).is_some_and(|&c| c != b'\n' && c != b'\r') {
                    at += 1;
                }
            }
            Some(b'/') if text.get(at + 1) == Some(&b'*') => {
                match text[at + 2..].windows(2).position(|w| w == b"*/") {
                    Some(end) => at += end + 4,
                    None => return text.len(),
                }
            }
            _ => return at,
        }
    }
}

/// `text` less the white space and the `/* */` comments it ends with.
fn trim_trivia_end(mut text: &[u8]) -> &[u8] {
    loop {
        text = text.trim_ascii_end();
        let Some(rest) = text.strip_suffix(b"*/") else {
            return text;
        };
        match rest.windows(2).rposition(|w| w == b"/*") {
            Some(open) => text = &text[..open],
            None => return text,
        }
    }
}

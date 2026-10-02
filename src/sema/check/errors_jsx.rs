//! Errors about JSX: 17004 2874 2875 2879 and what is said in their place, 7026 and 2339 for tags that are not components, 2604 2322
//! 2769 6229 for what a tag takes, 2558 2743 2344 for its type arguments, 2745 2746 2747 2710 for children, 2783 for what a spread
//! overwrites, 2786, 2609 17016 17017, and the grammar: 17000 17001 2639 18007.
//!
//! Follows `checkJsxOpeningLikeElementOrOpeningFragment`, `checkJsxPreconditions`, `getIntrinsicTagSymbol`,
//! `getJsxNamespace`, `getJsxFactoryEntity`, `getJsxNamespaceContainerForImplicitImport`, `getJSXFragmentType`,
//! `resolveJsxOpeningLikeElement`, `elaborateJsxComponents` and `checkJsxReturnAssignableToAppropriateBound` of TypeScript 7.0.2's
//! jsx.go, and `markJsxAliasReferenced`, `checkSpreadPropOverrides`, `getTypeArgumentArityError` and
//! `getCandidateForOverloadFailure` of its checker.go.

use super::errors::Diagnostic;
use super::jsx::JsxName;
use super::relate::Relation;
use super::*;
use crate::bind::ScopeId;
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
        // `resolveImportsAndModuleAugmentations`: only `ScriptKindTSX` and `ScriptKindJSX` import it.
        let path = &self.files().module(file).path;
        let runtime = crate::program::jsx_runtime_of(options, hir, atoms)
            .filter(|_| path.ends_with(".tsx") || path.ends_with(".jsx"))
            .map(|spec| atoms.intern_str(&spec));
        // `getJsxNamespaceContainerForImplicitImport`: the module elements are made with is imported unasked, and has to be there.
        let runtime_is_missing =
            runtime.is_some_and(|spec| self.files().module_of_specifier(file, spec).is_none());
        // `resolveExternalModule`: of a file that is found and is no module, that is what is said.
        let runtime_is_no_module =
            runtime.is_some_and(|spec| self.files().module(file).imported_file(spec).is_some());
        // Of JavaScript that is not in the program, what `errorOnImplicitAnyModule` says.
        let module = self.files().module(file);
        let untyped_runtime = runtime
            .map(|spec| (spec, module.default_mode))
            .filter(|untyped| !runtime_is_no_module && module.untyped_imports.contains(untyped));
        let (factory, fragment_factory) = (
            jsx_namespace(self.files(), hir, false),
            jsx_namespace(self.files(), hir, true),
        );
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
        // `checkJsxFragment`: whoever says what makes elements has to say what makes fragments.
        let says_factory = !options.jsx_factory.is_empty();
        let lacks_fragment_factory = matches!(
            jsx,
            JsxEmit::React | JsxEmit::ReactJsx | JsxEmit::ReactJsxDev
        ) && (says_factory || hir.jsx_pragmas.factory.is_some())
            && options.jsx_fragment_factory.is_empty()
            && hir.jsx_pragmas.fragment_factory.is_none();
        let intrinsic_elements = self.jsx_type(file, known::IntrinsicElements);
        let mut elements: Vec<ExprId> = self
            .exprs_by_kind(file)
            .of(ExprTag::Jsx)
            .iter()
            .copied()
            .filter(|e| !bound.is_unchecked(e.idx()))
            .collect();
        elements.sort_unstable_by_key(|&e| hir[e].pos);
        // What is said once for the file is said of what is checked first. What the walk does not reach comes last, in source order.
        let (mut first, mut first_fragment) = (None, None);
        if runtime_is_missing || checks_fragment_type {
            let reached = if elements.len() > 1 {
                self.check_source_file_alone(file, |checker| checker.first_jsx)
            } else {
                (None, None)
            };
            let is_fragment =
                |e: &ExprId| matches!(hir[*e].kind, ExprKind::Jsx(j) if hir[j].tag.is_none());
            first = reached.0.or(elements.first().copied());
            first_fragment = reached.1.or(elements.iter().copied().find(is_fragment));
        }
        for e in elements {
            let ExprKind::Jsx(j) = hir[e].kind else {
                continue;
            };
            let element = &hir[j];
            let start = hir[e].pos;
            // Where the opening tag ends, which is all there is to an element that closes itself.
            let end = element.opening_end;
            if element.tag.is_some() {
                self.check_grammar_jsx_element(file, j);
            }
            if jsx == JsxEmit::None {
                self.error((file, start, end), 17004, &[]);
            }
            if runtime_is_missing && first == Some(e) {
                // `checkJsxElement` passes the whole element to `getJsxElementTypeAt`. In a file that is emitted before it is checked,
                // `MarkLinkedReferencesRecursively` comes first, where `markJsxAliasReferenced` passes the opening element.
                let is_whole_element = self.p.files.options.no_emit_is_set
                    && element.tag.is_some()
                    && element.close_pos != u32::MAX;
                let end = if is_whole_element { element.end } else { end };
                if let Some((spec, mode)) = untyped_runtime {
                    if no_implicit_any {
                        self.error_on_implicit_any_module(file, spec, mode, (file, start, end));
                    }
                } else if let Some(spec) = runtime {
                    match self.files().module(file).imported_file(spec) {
                        Some(found) => {
                            let path = self.files().module(found).path.as_bytes();
                            self.error((file, start, end), 2306, &[Arg::Bytes(path)])
                        }
                        None => self.error((file, start, end), 2875, &[Arg::Atom(spec)]),
                    };
                }
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
                self.check_jsx_fragment(file, e);
                if lacks_fragment_factory {
                    let at = (file, start, self.end_inside_parentheses(file, e));
                    self.error(at, if says_factory { 17016 } else { 17017 }, &[]);
                }
                for child in hir.ids(element.children) {
                    self.check_jsx_expression(file, child);
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
            // `resolveUntypedCall`, `resolveErrorCall`: the attributes are looked at whatever becomes of the tag.
            if !element.attrs.is_empty() && !element.children.is_empty() {
                self.jsx_attributes_type(file, e);
            }
            for p in element.attrs.iter() {
                if hir[p].kind != PropKind::Spread {
                    self.check_grammar_jsx_expression(file, hir[p].value);
                }
            }
            for child in hir.ids(element.children) {
                self.check_jsx_expression(file, child);
            }
            self.check_spread_overrides(file, element.attrs);
            self.check_jsx_component(file, e);
            // `checkJsxElementDeferred`: `getIntrinsicTagSymbol` of the opening element, then of the closing one, each by its own name.
            // A closing name that is not intrinsic is an expression, checked like any other.
            let opening_name = self.jsx_intrinsic_tag_name(file, element.tag);
            let closing_name = if element.close_tag.is_some() {
                self.jsx_intrinsic_tag_name(file, element.close_tag)
            } else {
                None
            };
            for (name, start, is_closing) in [
                (opening_name, start, false),
                (closing_name, element.close_pos, true),
            ] {
                let Some(name) = name else { continue };
                let at = (file, start, if is_closing { element.end } else { end });
                match intrinsic_elements {
                    None if no_implicit_any => {
                        self.error(at, 7026, &[Arg::Bytes(b"IntrinsicElements")]);
                    }
                    Some(elements)
                        if self.is_known(elements)
                            && self.type_of_property(elements, name).is_none() =>
                    {
                        self.error(
                            at,
                            2339,
                            &[Arg::Atom(name), Arg::Bytes(b"JSX.IntrinsicElements")],
                        );
                    }
                    _ => {}
                }
            }
        }
    }

    /// `checkGrammarJsxElement`. The call to `checkGrammarTypeArguments` is not ported here.
    fn check_grammar_jsx_element(&mut self, file: FileId, j: JsxId) -> bool {
        let hir = self.hir(file);
        let jsx = &hir[j];
        // `checkGrammarJsxName`: a namespaced name `a:b` is lowered to a string. `IsIntrinsicJsxName` tests the namespace.
        if matches!(
            self.p.files.options.jsx,
            JsxEmit::React | JsxEmit::ReactJsx | JsxEmit::ReactJsxDev
        ) && let ExprKind::String(name) = hir[jsx.tag].kind
        {
            let name = self.files().atoms.bytes(name);
            if let Some(colon) = name.iter().position(|&c| c == b':')
                && !(name[0].is_ascii_lowercase() || name[..colon].contains(&b'-'))
            {
                let start = hir[jsx.tag].pos;
                let end = jsx_tag_name_end(&hir.text, start as usize) as u32;
                self.grammar_error_on_node((file, start, end), 2639, &[]);
            }
        }
        let mut seen: Vec<PropKey> = Vec::new();
        for p in jsx.attrs.iter() {
            let attr = &hir[p];
            if attr.kind == PropKind::Spread {
                continue;
            }
            if seen.contains(&attr.key) {
                let at = (file, attr.pos, self.end_of_jsx_attr_name(file, p));
                return self.grammar_error_on_node(at, 17001, &[]);
            }
            seen.push(attr.key);
            // The parser places the `Missing` of `name={}` at the `{`.
            if attr.value.is_some() && matches!(hir[attr.value].kind, ExprKind::Missing) {
                let start = hir[attr.value].pos;
                let at = (file, start, self.end_of_bracket_at(file, start));
                return self.grammar_error_on_node(at, 17000, &[]);
            }
        }
        false
    }

    /// `checkGrammarJsxExpression`, of what is written in braces.
    fn check_grammar_jsx_expression(&mut self, file: FileId, x: ExprId) -> bool {
        let hir = self.hir(file);
        let is_comma_sequence = x.is_some()
            && !is_parenthesized(hir, x)
            && matches!(
                hir[x].kind,
                ExprKind::Binary {
                    op: BinOp::Comma,
                    ..
                }
            );
        is_comma_sequence && {
            let at = (file, self.start_of(file, x), self.end_of_expr(file, x));
            self.grammar_error_on_node(at, 18007, &[])
        }
    }

    /// `checkJsxExpression`, of a child. A tuple type is no array type. `t != c.anyType`: the error type is reported too.
    fn check_jsx_expression(&mut self, file: FileId, child: ExprId) {
        let hir = self.hir(file);
        let ExprKind::Spread(spread) = hir[child].kind else {
            self.check_grammar_jsx_expression(file, child);
            return;
        };
        self.check_grammar_jsx_expression(file, spread);
        let ty = self.type_of_expr(file, spread);
        if self.is_known(ty)
            && ty != TypeId::ANY
            && !self.is_array(ty)
            && let Some(brace) = brace_before(hir, self.start_of(file, spread), true)
        {
            self.error(
                (file, brace, self.end_of_bracket_at(file, brace)),
                2609,
                &[],
            );
        }
    }

    /// `resolveJsxOpeningLikeElement` of the fragment `e`, which is a call of what fragments are made with: 2322 and what says more,
    /// of its children. Of several candidates, and of one that is generic, nothing is said.
    fn check_jsx_fragment(&mut self, file: FileId, e: ExprId) {
        let hir = self.hir(file);
        let ExprKind::Jsx(j) = hir[e].kind else {
            return;
        };
        // `getJsxNamespaceAt` goes by the name fragments are made with. Only where that leads to the `JSX` elements go by.
        if self.jsx_namespace_at(file, false) != self.jsx_namespace_at(file, true) {
            return;
        }
        let Some(fragment) = self.jsx_fragment_type(file, e) else {
            return;
        };
        let apparent = self.apparent_type(fragment);
        if !self.is_known(apparent) {
            return;
        }
        // `resolveErrorCall`
        if self.is_error_type(apparent) {
            return;
        }
        let Some((sigs, _)) = self.uninstantiated_jsx_signatures_of_type(file, fragment, e) else {
            return;
        };
        if self.is_untyped_function_call(fragment, apparent, sigs.len(), 0) {
            return;
        }
        let at = (file, hir[e].pos, hir[j].opening_end);
        if sigs.is_empty() {
            self.error(at, 2604, &[Arg::Bytes(text_of(hir, at.1, at.2))]);
            return;
        }
        let [sig] = sigs[..] else {
            return;
        };
        if !self.sig_type_params(sig).is_empty() {
            return;
        }
        // `getEffectiveFirstArgumentForJsxSignature`: the first parameter, whatever kind of signature it is.
        let props = self.jsx_effective_first_argument(file, e, sig, false);
        let given = self.jsx_attributes_type(file, e);
        if !self.is_known(props)
            || !self.is_known(given)
            || self
                .jsx_child_types(file, e)
                .iter()
                .any(|child| !self.is_known(child.1))
            || self.is_assignable(given, props)
        {
            return;
        }
        self.check_type_assignable_to(given, props, Some(at), None);
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
        if code == 2552 {
            let meaning = SymFlags::VALUE;
            super::errors::relate_name_meant(self, file, scope, name, meaning, false, at.0);
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
        let at = (file, tag_name, tag_end);
        // The last of several candidates.
        let mut last_candidate = None;
        let wanted: Vec<TypeId> = match self.jsx_intrinsic_tag_name(file, jsx.tag) {
            Some(name) => {
                let attributes = self.jsx_intrinsic_attributes(file, name);
                // An intrinsic element takes no type arguments. The attributes are checked all the same.
                if !jsx.type_args.is_empty() {
                    let fake =
                        self.jsx_intrinsic_signature(file, attributes.unwrap_or(TypeId::ERROR));
                    self.report_type_argument_arity(file, jsx.type_args, &[fake], out);
                }
                match attributes {
                    Some(attributes) => vec![attributes],
                    None => return,
                }
            }
            None => {
                let component = self.type_of_expr(file, jsx.tag);
                if !self.is_known(component) || self.is_any(component) {
                    return;
                }
                let apparent = self.apparent_type(component);
                if !self.is_known(apparent) {
                    return;
                }
                // `resolveErrorCall`
                if self.is_error_type(apparent) {
                    return;
                }
                let Some((sigs, construct)) =
                    self.uninstantiated_jsx_signatures_of_type(file, component, e)
                else {
                    return;
                };
                if self.is_untyped_function_call(component, apparent, sigs.len(), 0) {
                    return;
                }
                if sigs.is_empty() {
                    self.error(at, 2604, &[Arg::Bytes(text_of(hir, tag_name, tag_end))]);
                    return;
                }
                // `chooseOverload` skips every signature then, so `reportCallResolutionErrors` has no argument error to report.
                let has_correct_arity = sigs.iter().any(|&sig| {
                    let type_params = self.sig_type_params(sig);
                    self.has_correct_type_argument_arity(&type_params, jsx.type_args.len())
                });
                if !has_correct_arity {
                    self.report_type_argument_arity(file, jsx.type_args, &sigs, out);
                    return;
                }
                let candidates = self.candidates_in_order(&sigs).into_vec();
                if self.report_jsx_type_argument_constraints(file, jsx.type_args, &candidates) {
                    return;
                }
                if sigs.len() == 1 {
                    match self.jsx_props_type(file, e) {
                        Some(props) => vec![props],
                        None => return,
                    }
                } else {
                    last_candidate = candidates.last().copied();
                    match self.jsx_props_of_each(file, e, &candidates, construct) {
                        Some(wanted) => wanted,
                        None => return,
                    }
                }
            }
        };
        if wanted.iter().any(|&t| !self.is_known(t)) {
            return;
        }
        let (mut diags, mut related) = (Vec::new(), Vec::new());
        // No signature applies then, whatever the attributes are.
        if self.jsx_intrinsic_tag_name(file, jsx.tag).is_none()
            && let Some((least, factory, most)) = self.jsx_tag_expects_too_many_arguments(file, e)
        {
            // `entityNameToString`
            let mut tag = text_of(hir, tag_name, tag_end).to_vec();
            tag.retain(|c| !c.is_ascii_whitespace());
            let mut diagnostic = self.new_diagnostic(
                at,
                6229,
                &[
                    Arg::Bytes(&tag),
                    Arg::Number(least),
                    Arg::Bytes(&factory),
                    Arg::Number(most),
                ],
            );
            // `getSymbolAtLocation(tagName).ValueDeclaration`
            let declared = match hir[jsx.tag].kind {
                ExprKind::Ident(name) => self
                    .symbol_of_identifier(file, jsx.tag, name)
                    .filter(|&sym| self.files().flags(sym).intersects(SymFlags::VALUE))
                    .and_then(|sym| self.place_of_symbol(sym)),
                ExprKind::Dot { obj, name, .. } => {
                    let object = self.type_of_expr(file, obj);
                    let object = self.apparent_type(object);
                    let prop = self.prop_ref(object, name);
                    prop.and_then(|(prop, _)| self.place_of_prop(prop))
                }
                _ => None,
            };
            if let Some(declared) = declared {
                diagnostic.add_related_info(self.new_diagnostic(
                    declared,
                    2728,
                    &[Arg::Bytes(&tag)],
                ));
            }
            diags.push(diagnostic);
            if let Some(last) = last_candidate {
                related = self.last_overload_declared_here(last);
            }
        } else {
            // Nothing is said on the strength of what is not known.
            for p in jsx.attrs.iter() {
                let ty = if hir[p].kind == PropKind::Spread {
                    self.type_of_expr(file, hir[p].value)
                } else {
                    self.type_of_literal_prop(file, p)
                };
                if !self.is_known(ty) {
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
            if !self.elaborate_jsx_components(file, e, given, props, Some(&mut diags)) {
                self.check_type_assignable_to_ex(given, props, Some(at), None, Some(&mut diags));
            }
            if let Some(last) = last_candidate {
                related = self.related_to_last_jsx_candidate(file, e, last, given);
            }
        }
        // `reportCallResolutionErrors`
        for mut diagnostic in diags {
            if wanted.len() > 1 {
                diagnostic = self.new_diagnostic_chain(Some(diagnostic), at, 2770, &[]);
                diagnostic = self.new_diagnostic_chain(Some(diagnostic), at, 2769, &[]);
                let related = related.iter().cloned();
                let related = related.filter_map(super::explain::Related::into_reported);
                diagnostic.related_information.extend(related);
            }
            self.add_diagnostic(diagnostic);
        }
    }

    /// What `reportCallResolutionErrors` relates to each thing it says of `last`, the last of several candidates for the element
    /// `e`. `given`: the attributes.
    fn related_to_last_jsx_candidate(
        &mut self,
        file: FileId,
        e: ExprId,
        last: SigId,
        given: TypeId,
    ) -> Vec<super::explain::Related> {
        if !self.explains {
            return Vec::new();
        }
        let mut related = self.last_overload_declared_here(last);
        // `addImplementationSuccessElaboration`. Only a function has an implementation that is found here.
        if let Some(implementation) = self.implementation_signature(last)
            && let Some(props) = self.jsx_props_of_each(file, e, &[implementation], false)
            && let [props] = props[..]
            && self.is_known(props)
            && self.is_assignable(given, props)
            && let Some((of, func, _)) = self.sig_decl(implementation)
        {
            related.push(super::explain::Related {
                at: Some(self.place_of_signature_declaration(of, func)),
                code: 2793,
                args: Vec::new(),
            });
        }
        related
    }

    /// `chooseOverload` skips a candidate whose constraints the type arguments violate (`checkTypeArguments`). If that leaves none of
    /// `candidates`, reports 2344 for the last one skipped (`candidateForTypeArgumentError`). Returns whether it reported.
    fn report_jsx_type_argument_constraints(
        &mut self,
        file: FileId,
        type_args: IdList<TypeNodeId>,
        candidates: &[SigId],
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
        let at = (file, hir[node].pos, self.end_of_type_node(file, node));
        self.check_type_assignable_to(argument, constraint, Some(at), Some(2344));
        true
    }

    /// `checkTagNameDoesNotExpectTooManyArguments`: whether every way to call the tag of `e` wants more arguments than what elements are
    /// made with passes to a function it is given. If so: the fewest it wants, what elements are made with, and the most that passes.
    fn jsx_tag_expects_too_many_arguments(
        &mut self,
        file: FileId,
        e: ExprId,
    ) -> Option<(usize, Vec<u8>, usize)> {
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
        let names = jsx_factory_entity(files, hir, true);
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
        let factory: Vec<&[u8]> = names.iter().map(|&name| files.atoms.bytes(name)).collect();
        Some((least, factory.join(&b'.'), most))
    }

    /// `elaborateJsxComponents`
    fn elaborate_jsx_components(
        &mut self,
        file: FileId,
        e: ExprId,
        source: TypeId,
        target: TypeId,
        mut diagnostic_output: Option<&mut Vec<Reported>>,
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
            let (at, mut diags) = (
                (file, prop.pos, self.end_of_jsx_attr_name(file, p)),
                Vec::new(),
            );
            let output = Some(&mut diags);
            reported |=
                self.elaborate_element(source, target, at, prop.value, false, name, None, output);
            // `elaborateDidYouMeanToCallOrConstruct` is asked of the braces around the value before it is asked of the value: what it
            // says, which is all that is said where the value starts, is said where they start.
            let value = prop.value.some().map(|value| self.start_of(file, value));
            let brace = value.and_then(|value| brace_before(hir, value, false));
            for mut diagnostic in diags {
                if let Some(brace) = brace
                    && Some(diagnostic.start) == value
                {
                    let end = self.end_of_bracket_at(file, brace);
                    (diagnostic.start, diagnostic.end) = (brace, end);
                    for related in &mut diagnostic.related_information {
                        if matches!(related.code, 6212 | 6213) && Some(related.start) == value {
                            (related.start, related.end) = (brace, end);
                        }
                    }
                }
                self.report_diagnostic(diagnostic, diagnostic_output.as_deref_mut());
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
        let diagnostic = if children.len() > 1 && !lists.is_never() {
            let expected = (name, wanted);
            return reported
                | self.elaborate_jsx_children(
                    file,
                    e,
                    &children,
                    lists,
                    expected,
                    diagnostic_output,
                );
        } else if children.len() == 1 && !others.is_never() {
            // `getElaborationElementForJsxChild`
            let (child, _) = children[0];
            let Some(start) = self.jsx_child_start(file, e, &children, 0) else {
                return reported;
            };
            if !is_jsx_text(hir, e, child) {
                let inner = match hir[child].kind {
                    ExprKind::Spread(x) => x,
                    _ => child,
                };
                let at = (file, start, self.jsx_child_end(file, child, start));
                let output = diagnostic_output;
                return reported
                    | self.elaborate_element(source, target, at, inner, false, name, None, output);
            }
            // `elaborateElement`, with nothing to go into: whatever is wrong with text, the same is said of it.
            if self.is_generic_object_type(target)
                || matches!(self.data(wanted), TypeData::IndexedAccess { .. })
                || self.type_of_property(source, name).is_none()
                || is_related(self)
            {
                return reported;
            }
            let mut diagnostic =
                self.invalid_textual_child_diagnostic(file, e, start, (name, wanted));
            let related = self.expected_property(target, name);
            let related = related.and_then(super::explain::Related::into_reported);
            diagnostic.related_information.extend(related);
            diagnostic
        } else if !is_related(self) {
            let at = (file, tag_name_start(hir, e), tag_name_end(hir, e));
            let code = if children.len() > 1 { 2746 } else { 2745 };
            self.new_diagnostic(at, code, &[Arg::Atom(name), Arg::Type(wanted)])
        } else {
            return reported;
        };
        self.report_diagnostic(diagnostic, diagnostic_output);
        true
    }

    /// `getInvalidTextualChildDiagnostic`, of the text that starts at `start` in the element `e`. `expected`: the name the children go
    /// by, and what the tag takes under that name.
    fn invalid_textual_child_diagnostic(
        &mut self,
        file: FileId,
        e: ExprId,
        start: u32,
        expected: (Atom, TypeId),
    ) -> Reported {
        let hir = self.hir(file);
        let tag = text_of(hir, tag_name_start(hir, e), tag_name_end(hir, e));
        let args = [
            Arg::Bytes(tag),
            Arg::Atom(expected.0),
            Arg::Type(expected.1),
        ];
        self.new_diagnostic((file, start, jsx_text_end(hir, start)), 2747, &args)
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
        mut diagnostic_output: Option<&mut Vec<Reported>>,
    ) -> bool {
        let hir = self.hir(file);
        // `isArrayOrTupleLikeType`
        let arrays = self.filter(target, |c, m| c.is_array_like(m) || c.is_tuple_like(m));
        let iterables = self.filter(target, |c, m| !(c.is_array_like(m) || c.is_tuple_like(m)));
        let yielded = (!iterables.is_never()).then(|| self.iterated_type(iterables, false));
        let types: Vec<TypeId> = children.iter().map(|c| c.1).collect();
        let source = self.tuple(&types, &vec![ElemFlags::REQUIRED; types.len()], false);
        let mut said = Vec::new();
        for (i, &(child, given)) in children.iter().enumerate() {
            let key = self.number_literal(i as f64, false);
            // `getBestMatchIndexedAccessTypeOrUndefined`
            let mut indexed = None;
            if !arrays.is_never() {
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
                said.push(self.invalid_textual_child_diagnostic(file, e, at, expected));
                continue;
            }
            let inner = match hir[child].kind {
                ExprKind::Spread(x) => x,
                _ => child,
            };
            if !self.elaborate_error(file, inner, false, given, wanted, None, Some(&mut said)) {
                let end = self.jsx_child_end(file, child, at);
                // `removeMissingType`
                let name = self.number_name(i as f64);
                let apparent = self.apparent_type(arrays);
                let target_is_optional = self
                    .prop_of(apparent, name)
                    .is_some_and(|(prop, _)| prop.flags.contains(PropFlags::OPTIONAL));
                let wanted = self.remove_missing_type(wanted, target_is_optional);
                let output = Some(&mut said);
                self.check_type_assignable_to_ex(
                    given,
                    wanted,
                    Some((file, at, end)),
                    None,
                    output,
                );
            }
        }
        let reported = !said.is_empty();
        for diagnostic in said {
            self.report_diagnostic(diagnostic, diagnostic_output.as_deref_mut());
        }
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
            // White space is text too, unless a line ends in it (`JsxTextAllWhiteSpaces`).
            let text = &before[start..];
            let is_trivia = text.trim_ascii().is_empty()
                && (text.is_empty() || text.contains(&b'\n') || text.contains(&b'\r'));
            if !is_trivia {
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

    /// `checkSpreadPropOverrides`: 2783, what is written only to be overwritten by what is spread after it.
    pub(super) fn check_spread_overrides(&mut self, file: FileId, props: Span<PropId>) {
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
                    // `GetErrorRangeForNode`: a method is pointed at by its name, anything else as a whole.
                    let end = if hir[overwritten].kind == PropKind::Method {
                        self.end_of_prop_name(file, overwritten)
                    } else {
                        self.end_of_prop(file, overwritten)
                    };
                    // The spread starts at its `...`, that of an attribute at the `{`.
                    let spread = (file, prop.start, self.end_of_prop(file, p));
                    let spread = self.new_diagnostic(spread, 2785, &[]);
                    self.error((file, start, end), 2783, &[Arg::Atom(name)])
                        .add_related_info(spread);
                }
            }
        }
    }

    /// The end of `checkJsxOpeningLikeElementOrOpeningFragment`, `checkJsxReturnAssignableToAppropriateBound`: 2786.
    fn check_jsx_component(&mut self, file: FileId, e: ExprId) {
        let hir = self.hir(file);
        let ExprKind::Jsx(j) = hir[e].kind else {
            return;
        };
        let tag = hir[j].tag;
        let at = (file, tag_name_start(hir, e), tag_name_end(hir, e));
        let intrinsic = self.jsx_intrinsic_tag_name(file, tag);
        let mut diags = Vec::new();
        // `JSX.ElementType` says it all, if it is there.
        if let Some(allowed) = self.jsx_element_type_constraint(file) {
            let given = match intrinsic {
                Some(name) => self.string_literal(name, false),
                None => self.type_of_expr(file, tag),
            };
            let output = Some(&mut diags);
            self.check_type_assignable_to_ex(given, allowed, Some(at), Some(18053), output);
        } else if intrinsic.is_none() {
            self.check_jsx_return_assignable_to_appropriate_bound(file, e, at, &mut diags);
        }
        if let Some(first) = diags.pop() {
            let tag = Arg::Bytes(text_of(hir, at.1, at.2));
            let diagnostic = self.new_diagnostic_chain(Some(first), at, 2786, &[tag]);
            self.add_diagnostic(diagnostic);
        }
    }

    /// `checkJsxReturnAssignableToAppropriateBound`, as far as `diags`.
    fn check_jsx_return_assignable_to_appropriate_bound(
        &mut self,
        file: FileId,
        e: ExprId,
        at: (FileId, u32, u32),
        diags: &mut Vec<Reported>,
    ) {
        let hir = self.hir(file);
        let ExprKind::Jsx(j) = hir[e].kind else {
            return;
        };
        let tag = hir[j].tag;
        let component = self.type_of_expr(file, tag);
        if !self.is_known(component) || self.is_any(component) {
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
        if let Some(bound) = bound {
            self.check_type_assignable_to_ex(made, bound, Some(at), Some(head), Some(diags));
        }
    }

    /// What the signature `getResolvedSignature` settles on for the element `e` returns: of `sigs` the first that takes the attributes,
    /// or what `getCandidateForOverloadFailure` makes up. `hasCorrectTypeArgumentArity` is left out. `None`: it cannot be told.
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
        let candidates = self.candidates_in_order(sigs).into_vec();
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
        for relation in [Relation::Subtype, Relation::Assignable] {
            for &sig in &instantiated {
                let props = self.jsx_effective_first_argument(file, e, sig, construct);
                if !self.is_known(props) {
                    return None;
                }
                if self.related(given, props, relation) {
                    return Some(self.sig_return(sig));
                }
            }
        }
        let mut is_generic = false;
        for &sig in &candidates {
            is_generic |= !self.sig_type_params(sig).is_empty();
        }
        if is_generic {
            // The attributes and the children are one argument, if there are any.
            let count = usize::from(!hir[j].attrs.is_empty() || !hir[j].children.is_empty());
            let best = self.longest_candidate_index(&candidates, count);
            return Some(self.sig_return(instantiated[best]));
        }
        let combined = self.union_of_signatures_for_overload_failure(&instantiated);
        Some(self.sig_return(combined))
    }
}

/// `getJsxNamespace`
pub(super) fn jsx_namespace(files: &Files, hir: &hir::File, is_opening_fragment: bool) -> Atom {
    if is_opening_fragment {
        // `getJsxFragmentFactoryEntity`: a `@jsxFrag` pragma hides `jsxFragmentFactory` even if the pragma does not parse.
        let pragma = hir.jsx_pragmas.fragment_factory;
        let text = if pragma.is_some() {
            files.atoms.bytes(pragma)
        } else {
            files.options.jsx_fragment_factory.as_bytes()
        };
        if let Some(entity) = parse_isolated_entity_name(&files.atoms, text) {
            return entity[0];
        }
    }
    jsx_factory_entity(files, hir, !is_opening_fragment)[0]
}

/// `getJsxFactoryEntity`, as its identifiers from left to right. `is_local`: `localJsxFactory` counts, which is `@jsx` if it parses.
fn jsx_factory_entity(files: &Files, hir: &hir::File, is_local: bool) -> Vec<Atom> {
    let (options, atoms) = (&files.options, &files.atoms);
    let pragma = hir.jsx_pragmas.factory;
    if is_local
        && pragma.is_some()
        && let Some(entity) = parse_isolated_entity_name(atoms, atoms.bytes(pragma))
    {
        return entity;
    }
    // `_jsxFactoryEntity`: `reactNamespace` is read only if no `jsxFactory` is written, and is used whole.
    parse_isolated_entity_name(atoms, options.jsx_factory.as_bytes()).unwrap_or_else(|| {
        let namespace = if options.jsx_factory.is_empty() && !options.react_namespace.is_empty() {
            atoms.intern(options.react_namespace.as_bytes())
        } else {
            known::React
        };
        vec![namespace, atoms.intern(b"createElement")]
    })
}

/// `parseIsolatedEntityName`, as the identifiers of the name. The empty text is no name.
fn parse_isolated_entity_name(atoms: &crate::atom::Interner, text: &[u8]) -> Option<Vec<Atom>> {
    std::str::from_utf8(text)
        .is_ok_and(crate::verify::is_entity_name)
        .then(|| {
            text.split(|&c| c == b'.')
                .map(|name| atoms.intern(name.trim_ascii()))
                .collect()
        })
}

fn text_of(hir: &hir::File, start: u32, end: u32) -> &[u8] {
    &hir.text[start as usize..end as usize]
}

/// Where the name in the opening tag of the element `e` starts.
fn tag_name_start(hir: &hir::File, e: ExprId) -> u32 {
    skip_trivia(&hir.text, hir[e].pos as usize + 1) as u32
}

/// Where it ends.
fn tag_name_end(hir: &hir::File, e: ExprId) -> u32 {
    jsx_tag_name_end(&hir.text, tag_name_start(hir, e) as usize) as u32
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

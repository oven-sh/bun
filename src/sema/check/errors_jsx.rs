//! Errors about JSX: 17004 2874 2875 2879 and what is said in their place, 7026 and 2339 for tags that are not components, 2604 2322
//! 2769 6229 for what a tag takes, 2558 2743 2344 for its type arguments, 2745 2746 2747 2710 for children, 2783 for what a spread
//! overwrites, 2786, 2609 17016 17017, and the grammar: 17000 17001 2639 18007.
//!
//! Follows `checkJsxOpeningLikeElementOrOpeningFragment`, `checkJsxPreconditions`, `getIntrinsicTagSymbol`,
//! `getJsxNamespace`, `getJsxFactoryEntity`, `getJsxNamespaceContainerForImplicitImport`, `getJSXFragmentType`,
//! `resolveJsxOpeningLikeElement`, `elaborateJsxComponents` and `checkJsxReturnAssignableToAppropriateBound` of TypeScript 7.0.2's
//! jsx.go, and `markJsxAliasReferenced`, `checkSpreadPropOverrides`, `getTypeArgumentArityError` and
//! `getCandidateForOverloadFailure` of its checker.go.

use super::call::CallLike;
use super::explain::NOWHERE;
use super::infer::Inference;
use super::jsx::{JsxName, JsxReferenceKind};
use super::relate::Relation;
use super::*;
use crate::bind::ScopeId;
use crate::resolve::JsxEmit;

impl Checker<'_> {
    pub(super) fn check_jsx(&mut self, file: FileId) {
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
            .filter(|_| path.ends_with(b".tsx") || path.ends_with(b".jsx"))
            .map(|spec| atoms.intern(&spec));
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
            // Nobody else can ask about a file that nothing refers to.
            let reached = if crate::local::file() == file.0 {
                self.first_jsx
            } else if elements.len() > 1 {
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
                self.error_at((file, start, end), 17004, &[]);
            }
            self.resolved_signature(file, e);
            self.report_call_resolution(file, e);
            if runtime_is_missing && first == Some(e) {
                // `checkJsxElement` passes the whole element to `getJsxElementTypeAt`. In a file that is emitted before it is checked,
                // `MarkLinkedReferencesRecursively` comes first, where `markJsxAliasReferenced` passes the opening element.
                let is_whole_element = self.p.files.options.no_emit
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
                            let path = &self.files().module(found).path;
                            self.error_at((file, start, end), 2306, &[Arg::Bytes(path)])
                        }
                        None => self.error_at((file, start, end), 2875, &[Arg::Atom(spec)]),
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
                    self.explain_missing_jsx_factory(
                        file,
                        e,
                        scope,
                        (start, end),
                        fragment_factory,
                        2874,
                    );
                }
                if factory_is_missing {
                    self.explain_missing_jsx_factory(file, e, scope, (start, end), factory, 2874);
                }
                if gives_fragment_type && fragment_factory_is_missing {
                    self.explain_missing_jsx_factory(
                        file,
                        e,
                        scope,
                        (start, end),
                        fragment_factory,
                        2879,
                    );
                }
                if lacks_fragment_factory {
                    let at = (file, start, self.end_inside_parentheses(file, e));
                    self.error_at(at, if says_factory { 17016 } else { 17017 }, &[]);
                }
                for child in hir.ids(element.children) {
                    self.check_jsx_expression(file, child);
                }
                continue;
            }
            if factory_is_missing {
                let at = (tag_name_start(hir, e), tag_name_end(hir, e));
                self.explain_missing_jsx_factory(file, e, scope, at, factory, 2874);
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
                        self.error_at(at, 7026, &[Arg::Bytes(b"IntrinsicElements")]);
                    }
                    Some(elements)
                        if self.is_known(elements)
                            && self.type_of_property(elements, name).is_none() =>
                    {
                        self.error_at(
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
                self.grammar_error_at((file, start, end), 2639, &[]);
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
                return self.grammar_error_at(at, 17001, &[]);
            }
            seen.push(attr.key);
            // The parser places the `Missing` of `name={}` at the `{`.
            if attr.value.is_some() && matches!(hir[attr.value].kind, ExprKind::Missing) {
                let at = (file, hir[attr.value].pos, attr.end);
                return self.grammar_error_at(at, 17000, &[]);
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
            self.grammar_error_at(at, 18007, &[])
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
            && let Some((brace, end)) = jsx_expression_around(hir, child)
        {
            self.error_at((file, brace, end), 2609, &[]);
        }
    }

    /// `resolveJsxOpeningLikeElement`
    pub(super) fn resolve_jsx_opening_like_element(
        &mut self,
        file: FileId,
        e: ExprId,
        j: JsxId,
    ) -> ResolvedCall {
        let hir = self.hir(file);
        let jsx = &hir[j];
        let is_jsx_open_fragment = jsx.tag.is_none();
        let error_node = if is_jsx_open_fragment {
            (file, hir[e].pos, jsx.opening_end)
        } else {
            (file, tag_name_start(hir, e), tag_name_end(hir, e))
        };
        let expr_types = if is_jsx_open_fragment {
            // `getJsxNamespaceAt` goes by the name fragments are made with. Only where that leads to the `JSX` elements go by.
            let is_one_jsx =
                self.jsx_namespace_at(file, false) == self.jsx_namespace_at(file, true);
            let fragment = self.jsx_fragment_type(file, e);
            fragment.filter(|_| is_one_jsx).unwrap_or(TypeId::ANY)
        } else if let Some(name) = self.jsx_intrinsic_tag_name(file, jsx.tag) {
            let result = self.jsx_intrinsic_attributes(file, name);
            let result = result.unwrap_or(TypeId::ERROR);
            let fake_signature = self.jsx_intrinsic_signature(file, result);
            let param_type = self.jsx_effective_first_argument(file, e, fake_signature);
            // As `CallState::checks_arguments_once`.
            let is_checked_once = self.resolution_start == self.stack.len()
                && self.stack.last() == Some(&Query::Call(file, e));
            let source = self.check_jsx_attributes_with_contextual_type(
                file,
                e,
                param_type,
                None,
                CheckMode::empty(),
                is_checked_once,
            );
            let resolved = ResolvedCall {
                sig: Some(fake_signature),
                ret: self.sig_return(fake_signature),
            };
            // As in `resolve_call`: what is looked at for the sake of an error goes by the signature.
            self.resolved_meanwhile.push((file, e, resolved));
            let relation = Relation::Assignable;
            let at = Some(error_node);
            self.check_jsx_attributes_related_to(file, e, source, result, relation, at);
            self.resolved_meanwhile.pop();
            if let Some(first) = hir.ids(jsx.type_args).next() {
                let end = self.end_of_type_argument_list(file, jsx.type_args);
                let args = [Arg::Number(0), Arg::Number(jsx.type_args.len())];
                self.error_at((file, hir[first].pos, end), 2558, &args);
            }
            return resolved;
        } else {
            self.type_of_expr(file, jsx.tag)
        };
        // `resolveUntypedCall`, `resolveErrorCall`: the attributes are looked at whatever becomes of the tag.
        let unresolved = |c: &mut Self, ret: TypeId| {
            if !is_jsx_open_fragment {
                c.jsx_attributes_type(file, e);
            }
            ResolvedCall { sig: None, ret }
        };
        let apparent_type = self.apparent_type(expr_types);
        if self.is_error_type(apparent_type) {
            return unresolved(self, TypeId::ERROR);
        }
        let Some(signatures) = self.uninstantiated_jsx_signatures_of_type(file, expr_types, e)
        else {
            return unresolved(self, TypeId::UNRESOLVED);
        };
        if self.is_untyped_function_call(expr_types, apparent_type, signatures.len(), 0) {
            return unresolved(self, TypeId::ANY);
        }
        if signatures.is_empty() {
            let text = Arg::Bytes(text_of(hir, error_node.1, error_node.2));
            self.error_at(error_node, 2604, &[text]);
            return unresolved(self, TypeId::ERROR);
        }
        let type_args = self.types_from_nodes(file, jsx.type_args);
        let node = CallLike::Jsx(j);
        let args = self.effective_call_arguments(file, e, node);
        self.resolve_call(
            file,
            e,
            node,
            &signatures,
            &type_args,
            &args,
            None,
            true,
            true,
            None,
        )
    }

    /// `getContextualJsxElementAttributesType`
    pub(super) fn contextual_jsx_element_attributes_type(
        &mut self,
        file: FileId,
        e: ExprId,
    ) -> Option<TypeId> {
        let pushed = self.contextual.iter().rev();
        if let Some(&(.., ty)) = pushed.clone().find(|c| c.0 == file && c.1 == e) {
            return Some(ty);
        }
        // `getContextualTypeForJsxExpression`: nothing is expected of a child of a fragment. `getContextualTypeForArgumentAtIndex`:
        // nor of anything while the element is `resolvingSignature`.
        let hir = self.hir(file);
        let ExprKind::Jsx(j) = hir[e].kind else {
            return None;
        };
        if hir[j].tag.is_none() {
            return None;
        }
        // FOR SPEED, kept: every attribute and every child asks.
        if let Some(kept) = self.p.jsx_attributes_types.get(&(file, j)) {
            return Some(kept);
        }
        if self.p.calls.get(&(file, e)).is_none()
            && !self
                .resolved_meanwhile
                .iter()
                .any(|r| r.0 == file && r.1 == e)
            && self.stack.contains(&Query::Call(file, e))
        {
            return None;
        }
        let signature = self.resolved_signature(file, e).sig?;
        let ty = self.jsx_effective_first_argument(file, e, signature);
        if self.p.calls.get(&(file, e)).is_some() {
            self.p.jsx_attributes_types.insert((file, j), ty);
        }
        Some(ty)
    }

    /// `isContextSensitive`, of `JsxAttributes`. A fragment has none.
    pub(super) fn is_jsx_attributes_context_sensitive(&self, file: FileId, j: JsxId) -> bool {
        let hir = self.hir(file);
        let values = hir[j].attrs.iter().map(|p| hir[p].value);
        hir[j].tag.is_some()
            && values
                .filter(|value| value.is_some())
                .chain(hir.ids(hir[j].children))
                .any(|part| self.is_context_sensitive(file, part))
    }

    /// `inferJsxTypeArguments`
    pub(super) fn infer_jsx_type_arguments(
        &mut self,
        file: FileId,
        e: ExprId,
        signature: SigId,
        check_mode: CheckMode,
        context: &mut Inference,
    ) -> MapperId {
        let param_type = self.jsx_effective_first_argument(file, e, signature);
        let check_attr_type = self.check_jsx_attributes_with_contextual_type(
            file,
            e,
            param_type,
            Some(context),
            check_mode,
            false,
        );
        self.infer(context, check_attr_type, param_type, 0);
        self.inference_mapper(context)
    }

    /// `checkExpressionWithContextualType(node.Attributes(), ..)`. `getContextNode`: it is pushed for the element, "so it encompasses
    /// the attributes and the children". `is_checked_once`: FOR SPEED, see `CallState::checks_arguments_once` and `arg_type_kept_under`.
    fn check_jsx_attributes_with_contextual_type(
        &mut self,
        file: FileId,
        e: ExprId,
        contextual_type: TypeId,
        inference_context: Option<&mut Inference>,
        check_mode: CheckMode,
        is_checked_once: bool,
    ) -> TypeId {
        self.contextual.push((file, e, contextual_type));
        let ty = if is_checked_once {
            self.inference_contexts.push(InferenceContextInfo {
                file,
                node: e,
                context: None,
            });
            let outer = self.suspend_recheck();
            // `checkJsxAttribute`: each is looked at there and then, while what is expected of it is pushed. Ours are asked for when
            // they are read, which is after the pop.
            let hir = self.hir(file);
            if let ExprKind::Jsx(j) = hir[e].kind {
                for p in hir[j].attrs.iter() {
                    if hir[p].kind != PropKind::Spread {
                        self.type_of_literal_prop(file, p);
                    }
                }
            }
            let ty = self.jsx_attributes_type(file, e);
            self.end_recheck(outer);
            self.inference_contexts.pop();
            ty
        } else {
            self.check_with_inference_context(
                file,
                e,
                contextual_type,
                inference_context,
                check_mode,
                |c, _| c.jsx_attributes_type(file, e),
            )
        };
        self.contextual.pop();
        ty
    }

    /// `checkApplicableSignatureForJsxCallLikeElement`
    #[allow(clippy::too_many_arguments)]
    pub(super) fn check_applicable_signature_for_jsx_call_like_element(
        &mut self,
        file: FileId,
        e: ExprId,
        signature: SigId,
        relation: Relation,
        check_mode: CheckMode,
        is_checked_once: bool,
        report_errors: bool,
    ) -> bool {
        let hir = self.hir(file);
        let ExprKind::Jsx(j) = hir[e].kind else {
            return true;
        };
        let tag = hir[j].tag;
        let param_type = self.jsx_effective_first_argument(file, e, signature);
        let attributes_type = if tag.is_none() {
            self.jsx_attributes_type(file, e)
        } else {
            self.check_jsx_attributes_with_contextual_type(
                file,
                e,
                param_type,
                None,
                check_mode,
                is_checked_once,
            )
        };
        let check_attributes_type = if check_mode.contains(CheckMode::SKIP_CONTEXT_SENSITIVE) {
            self.regular_type_of_object_literal(attributes_type)
        } else {
            attributes_type
        };
        let error_node = if tag.is_none() {
            (file, hir[e].pos, hir[j].opening_end)
        } else {
            (file, tag_name_start(hir, e), tag_name_end(hir, e))
        };
        if tag.is_some()
            && self.jsx_intrinsic_tag_name(file, tag).is_none()
            && let Some((least, factory, most)) = self.jsx_tag_expects_too_many_arguments(file, e)
        {
            if !report_errors {
                return false;
            }
            // `entityNameToString`
            let mut name = text_of(hir, error_node.1, error_node.2).to_vec();
            name.retain(|c| !c.is_ascii_whitespace());
            let (least, most) = (Arg::Number(least), Arg::Number(most));
            let args = [Arg::Bytes(&name), least, Arg::Bytes(&factory), most];
            let mut diagnostic = self.new_diagnostic(error_node, 6229, &args);
            // `getSymbolAtLocation(tagName).ValueDeclaration`
            let declared = match hir[tag].kind {
                ExprKind::Ident(name) => self
                    .symbol_of_identifier(file, tag, name)
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
                diagnostic.add_related_info(self.new_diagnostic(declared, 2728, &[args[0]]));
            }
            self.add_diagnostic(diagnostic);
            return false;
        }
        let error_node = report_errors.then_some(error_node);
        let (source, target) = (check_attributes_type, param_type);
        self.check_jsx_attributes_related_to(file, e, source, target, relation, error_node)
    }

    /// `checkTypeRelatedToAndOptionallyElaborate(source, target, relation, errorNode, node.Attributes(), ..)`, of the element `e`. In
    /// doubt they are related, but for the subtype pass.
    fn check_jsx_attributes_related_to(
        &mut self,
        file: FileId,
        e: ExprId,
        source: TypeId,
        target: TypeId,
        relation: Relation,
        error_node: Option<(FileId, u32, u32)>,
    ) -> bool {
        let hir = self.hir(file);
        let ExprKind::Jsx(j) = hir[e].kind else {
            return true;
        };
        if !self.is_known(source) || !self.is_known(target) {
            return relation != Relation::Subtype;
        }
        if self.related(source, target, relation) {
            return true;
        }
        if error_node.is_some()
            && (hir[j].tag.is_none() || !self.elaborate_jsx_components(file, e, source, target))
        {
            self.check_type_related_to_ex(source, target, relation, error_node, None, None);
        }
        false
    }

    /// `onFailedToResolveSymbol`, of `name`, which makes the tag `e`. It is looked for from `scope`, and is not written where the error
    /// goes, from `at.0` to `at.1`.
    fn explain_missing_jsx_factory(
        &mut self,
        file: FileId,
        e: ExprId,
        scope: ScopeId,
        at: (u32, u32),
        name: Atom,
        message: u32,
    ) {
        let (location, at) = (self.hir(file).node(e), Some((file, at.0, at.1)));
        self.on_failed_to_resolve_symbol(file, location, at, scope, name, SymFlags::VALUE, message);
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
            let braces = (prop.value.some()).and_then(|value| jsx_expression_around(hir, value));
            for mut diagnostic in diags {
                if let Some((brace, end)) = braces
                    && Some(diagnostic.start) == value
                {
                    (diagnostic.start, diagnostic.end) = (brace, end);
                    for related in &mut diagnostic.related_information {
                        if matches!(related.code, 6212 | 6213) && Some(related.start) == value {
                            (related.start, related.end) = (brace, end);
                        }
                    }
                }
                self.add_diagnostic(diagnostic);
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
            return reported | self.elaborate_jsx_children(file, e, &children, lists, expected);
        } else if children.len() == 1 && !others.is_never() {
            // `getElaborationElementForJsxChild`
            let (child, _) = children[0];
            let (start, end) = range_of_jsx_child(hir, child);
            if !is_jsx_text(hir, child) {
                let inner = match hir[child].kind {
                    ExprKind::Spread(x) => x,
                    _ => child,
                };
                let at = (file, start, end);
                return reported
                    | self.elaborate_element(source, target, at, inner, false, name, None, None);
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
                self.invalid_textual_child_diagnostic(file, e, (start, end), (name, wanted));
            let related = self.expected_property(target, name);
            let related = related.filter(|related| related.file != NOWHERE.0);
            diagnostic.related_information.extend(related);
            diagnostic
        } else if !is_related(self) {
            let at = (file, tag_name_start(hir, e), tag_name_end(hir, e));
            let code = if children.len() > 1 { 2746 } else { 2745 };
            self.new_diagnostic(at, code, &[Arg::Atom(name), Arg::Type(wanted)])
        } else {
            return reported;
        };
        self.add_diagnostic(diagnostic);
        true
    }

    /// `getInvalidTextualChildDiagnostic`, of the text from `start` to `end` in the element `e`. `expected`: the name the children go
    /// by, and what the tag takes under that name.
    fn invalid_textual_child_diagnostic(
        &mut self,
        file: FileId,
        e: ExprId,
        (start, end): (u32, u32),
        expected: (Atom, TypeId),
    ) -> Reported {
        let hir = self.hir(file);
        let tag = text_of(hir, tag_name_start(hir, e), tag_name_end(hir, e));
        let args = [
            Arg::Bytes(tag),
            Arg::Atom(expected.0),
            Arg::Type(expected.1),
        ];
        self.new_diagnostic((file, start, end), 2747, &args)
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
    ) -> bool {
        let hir = self.hir(file);
        // `isArrayOrTupleLikeType`
        let arrays = self.filter(target, |c, m| c.is_array_like(m) || c.is_tuple_like(m));
        let iterables = self.filter(target, |c, m| !(c.is_array_like(m) || c.is_tuple_like(m)));
        let yielded = (!iterables.is_never()).then(|| self.iterated_type(iterables, false));
        let types: Vec<TypeId> = children.iter().map(|c| c.1).collect();
        let source = self.tuple(&types, &vec![ElemFlags::REQUIRED; types.len()], false);
        let mut reported_error = false;
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
            reported_error = true;
            let (at, end) = range_of_jsx_child(hir, child);
            if is_jsx_text(hir, child) {
                let diagnostic =
                    self.invalid_textual_child_diagnostic(file, e, (at, end), expected);
                self.add_diagnostic(diagnostic);
                continue;
            }
            let inner = match hir[child].kind {
                ExprKind::Spread(x) => x,
                _ => child,
            };
            if !self.elaborate_error(file, inner, false, given, wanted, None, None) {
                // `removeMissingType`
                let name = self.number_name(i as f64);
                let apparent = self.apparent_type(arrays);
                let target_is_optional = self
                    .prop_of(apparent, name)
                    .is_some_and(|(prop, _)| prop.flags.contains(PropFlags::OPTIONAL));
                let wanted = self.remove_missing_type(wanted, target_is_optional);
                self.check_type_assignable_to(given, wanted, Some((file, at, end)), None);
            }
        }
        reported_error
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
                    self.error_at((file, start, end), 2783, &[Arg::Atom(name)])
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
            let elem_instance_type = self.resolved_signature(file, e).ret;
            let ref_kind = self.jsx_reference_kind(file, tag);
            let diags = &mut diags;
            self.check_jsx_return_assignable_to_appropriate_bound(
                ref_kind,
                elem_instance_type,
                at,
                diags,
            );
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
        ref_kind: JsxReferenceKind,
        elem_instance_type: TypeId,
        tag_name: (FileId, u32, u32),
        diags: &mut Vec<Reported>,
    ) {
        // `getJsxStatelessElementTypeAt`, `getJsxElementClassTypeAt`
        let element = self.jsx_type(tag_name.0, known::Element);
        let sfc_return_constraint = element.map(|element| self.union(&[element, TypeId::NULL]));
        let class_constraint = self.jsx_type(tag_name.0, known::ElementClass);
        let (constraint, head) = match (ref_kind, sfc_return_constraint, class_constraint) {
            (JsxReferenceKind::Function, constraint, _) => (constraint, 2787),
            (JsxReferenceKind::Component, _, constraint) => (constraint, 2788),
            (JsxReferenceKind::Mixed, Some(sfc), Some(class)) => {
                (Some(self.union(&[sfc, class])), 2789)
            }
            (JsxReferenceKind::Mixed, ..) => return,
        };
        if let Some(constraint) = constraint {
            let (at, head) = (Some(tag_name), Some(head));
            self.check_type_assignable_to_ex(elem_instance_type, constraint, at, head, Some(diags));
        }
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
            &files.options.jsx_fragment_factory
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
    parse_isolated_entity_name(atoms, &options.jsx_factory).unwrap_or_else(|| {
        let namespace = if options.jsx_factory.is_empty() && !options.react_namespace.is_empty() {
            atoms.intern(&options.react_namespace)
        } else {
            known::React
        };
        vec![namespace, atoms.intern(b"createElement")]
    })
}

/// `parseIsolatedEntityName`, as the identifiers of the name. The empty text is no name.
fn parse_isolated_entity_name(atoms: &crate::atom::Interner, text: &[u8]) -> Option<Vec<Atom>> {
    crate::verify::is_entity_name(text).then(|| {
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

/// Whether the `child` of an element is `JsxText`: a string that is in no braces.
fn is_jsx_text(hir: &hir::File, child: ExprId) -> bool {
    matches!(hir[child].kind, ExprKind::String(_)) && jsx_expression_around(hir, child).is_none()
}

/// From where to where the `child` of an element goes: its braces, if it is in any.
fn range_of_jsx_child(hir: &hir::File, child: ExprId) -> (u32, u32) {
    jsx_expression_around(hir, child).unwrap_or((hir[child].pos, hir[child].end))
}

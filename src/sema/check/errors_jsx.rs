//! Errors about JSX: 17004 2874 2875 2879 and the codes that replace them, 7026 and 2339 for tags
//! that are not components, 2604 2322 2769 6229 for the attributes a tag accepts, 2558 2743 2344
//! for its type arguments, 2745 2746 2747 2710 for children, 2783 for attributes a spread
//! overwrites, 2786, 2609 17016 17017, and the grammar: 17000 17001 2639 18007.
//!
//! Follows `checkJsxOpeningLikeElementOrOpeningFragment`, `checkJsxPreconditions`,
//! `getIntrinsicTagSymbol`, `getJsxNamespace`, `getJsxFactoryEntity`,
//! `getJsxNamespaceContainerForImplicitImport`, `getJSXFragmentType`,
//! `resolveJsxOpeningLikeElement`, `elaborateJsxComponents` and
//! `checkJsxReturnAssignableToAppropriateBound` of TypeScript 7.0.2's jsx.go, and
//! `markJsxAliasReferenced`, `checkSpreadPropOverrides`, `getTypeArgumentArityError` and
//! `getCandidateForOverloadFailure` of its checker.go.

use super::call::{CallLike, ExpectsReturn};
use super::errors_names_and_exports::is_valid_type_only_alias_use_site;
use super::infer::Inference;
use super::jsx::{JsxName, JsxReferenceKind};
use super::relate::Relation;
use super::symbols::IterationUse;
use super::*;
use crate::bind::ScopeId;
use crate::resolve::JsxEmit;

impl Checker<'_, '_> {
    pub(super) fn check_jsx(&mut self, file: FileId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if hir.jsx.is_empty() {
            return;
        }
        let options = &self.p.files.options;
        let (jsx, no_implicit_any) = (options.jsx, options.no_implicit_any);
        let atoms = &self.atoms();
        // `resolveImportsAndModuleAugmentations`: only `ScriptKindTSX` and `ScriptKindJSX` import it.
        let path = self.files().module(file).file_name();
        // The only atom it reads is one that the parser interned.
        let runtime = crate::program::jsx_runtime_of(options, hir, &self.p.files.atoms)
            .filter(|_| crate::resolve::is_jsx_file_name(path))
            .map(|spec| atoms.intern(&spec));
        // `getJsxNamespaceContainerForImplicitImport`: the JSX runtime module is imported
        // implicitly, and must exist.
        let runtime_is_missing =
            runtime.is_some_and(|spec| self.files().module_of_specifier(file, spec).is_none());
        let (factory, fragment_factory) = (
            jsx_namespace(self.files(), self.atoms(), hir, false),
            jsx_namespace(self.files(), self.atoms(), hir, true),
        );
        let names_fragment_factory = atoms.bytes(fragment_factory) != b"null";
        // `markJsxAliasReferenced`: an unresolved module is treated as if none were requested.
        let has_no_imports = runtime.is_none() || runtime_is_missing;
        let checks_factory = has_no_imports && jsx == JsxEmit::React;
        // `getJSXFragmentType`
        let checks_fragment_type = has_no_imports
            && names_fragment_factory
            && (jsx == JsxEmit::React || !options.jsx_fragment_factory.is_empty());
        // Where tags are emitted unchanged, an enum does not qualify.
        let meaning = if matches!(jsx, JsxEmit::Preserve | JsxEmit::ReactNative) {
            SymFlags::VALUE.difference(SymFlags::ENUM)
        } else {
            SymFlags::VALUE
        };
        let is_missing = |c: &Self, scope: ScopeId, name: Atom| {
            c.files().resolve_name(file, scope, name, meaning).is_none()
        };
        // `checkJsxFragment`: specifying a JSX factory requires specifying a fragment factory.
        let specifies_factory = !options.jsx_factory.is_empty();
        let lacks_fragment_factory = matches!(
            jsx,
            JsxEmit::React | JsxEmit::ReactJsx | JsxEmit::ReactJsxDev
        ) && (specifies_factory || hir.jsx_pragmas.factory.is_some())
            && options.jsx_fragment_factory.is_empty()
            && hir.jsx_pragmas.fragment_factory.is_none();
        let mut elements: Vec<ExprId> = self
            .exprs_by_kind(file)
            .of(ExprTag::Jsx)
            .iter()
            .copied()
            .filter(|e| !bound.is_unchecked(e.idx()))
            .collect();
        elements.sort_unstable_by_key(|&e| hir[e].pos);
        // An error reported once per file is reported on the element that is checked first.
        // Elements the walk does not reach come last, in source order.
        let (mut first, mut first_fragment) = (None, None);
        if runtime.is_some() || checks_fragment_type {
            // Only this task stores the entry of a JSX element of the file (`is_noted_for_check_file`), so it has evaluated each itself.
            let reached = match self.first_jsx {
                (of, first, first_fragment) if of == file => (first, first_fragment),
                _ => (None, None),
            };
            let is_fragment =
                |e: &ExprId| matches!(hir[*e].kind, ExprKind::Jsx(j) if hir[j].tag.is_none());
            first = reached.0.or_else(|| elements.first().copied());
            first_fragment = reached
                .1
                .or_else(|| elements.iter().copied().find(is_fragment));
        }
        for e in elements {
            let ExprKind::Jsx(j) = hir[e].kind else {
                continue;
            };
            let element = &hir[j];
            let start = hir[e].pos;
            // End of the opening tag, which is the whole of a self-closing element.
            let end = element.opening_end;
            if element.tag.is_some() {
                self.check_grammar_jsx_element(file, j);
            }
            if jsx == JsxEmit::None {
                self.error_at((file, start, end), 17004, &[]);
            }
            self.resolved_signature(file, e);
            self.report_call_resolution(file, e);
            if first == Some(e)
                && let Some(spec) = runtime
            {
                // `checkJsxElement` passes the whole element to `getJsxElementTypeAt`. In a file that is emitted before it is checked,
                // `MarkLinkedReferencesRecursively` comes first, where `markJsxAliasReferenced` passes the opening element.
                let is_whole_element = self.p.files.options.no_emit
                    && element.tag.is_some()
                    && element.close_pos != u32::MAX;
                let end = if is_whole_element { element.end } else { end };
                // `getJSXRuntimeImportSpecifier`: the specifier of the synthetic import the loader
                // added, which has no import clause and is nowhere in the text.
                let specifier = SpecifierUse {
                    spec,
                    pos: u32::MAX,
                    kind: SpecifierKind::Import,
                    mode: self.files().module(file).default_mode,
                };
                let (site, location) = (SpecifierSite::default(), (file, start, end));
                self.resolve_external_module_at(file, specifier, site, location, Some(2875));
            }
            // `resolveName`, starting at `jsxFactoryLocation`: the tag name, or the opening fragment.
            let scope = bound.expr_scope.get(&e).copied().unwrap_or(ScopeId(0));
            let jsx_factory_sym = checks_factory
                .then(|| self.files().resolve_name(file, scope, factory, meaning))
                .flatten();
            let factory_is_missing = checks_factory && jsx_factory_sym.is_none();
            if element.tag.is_none() {
                let provides_fragment_type = checks_fragment_type && first_fragment == Some(e);
                let fragment_factory_is_missing = (checks_factory || provides_fragment_type)
                    && names_fragment_factory
                    && is_missing(self, scope, fragment_factory);
                let mut failed_to_resolve = |name: Atom, name_not_found_message: u32| {
                    let location = self.jsx_opening_like(file, e);
                    self.on_failed_to_resolve_symbol(
                        file,
                        location,
                        None,
                        scope,
                        name,
                        meaning,
                        name_not_found_message,
                    );
                };
                if checks_factory && fragment_factory_is_missing {
                    failed_to_resolve(fragment_factory, 2874);
                }
                if factory_is_missing {
                    failed_to_resolve(factory, 2874);
                }
                if provides_fragment_type && fragment_factory_is_missing {
                    failed_to_resolve(fragment_factory, 2879);
                }
                if provides_fragment_type
                    && let Some(result) =
                        self.files()
                            .resolve_name(file, scope, fragment_factory, meaning)
                {
                    let node = self.jsx_opening_like(file, e);
                    self.on_successfully_resolved_symbol(file, node, scope, result, meaning);
                }
                if lacks_fragment_factory {
                    let at = (file, start, self.end_inside_parentheses(file, e));
                    self.error_at(at, if specifies_factory { 17016 } else { 17017 }, &[]);
                }
                for child in hir.ids(element.children) {
                    self.check_jsx_expression(file, child);
                }
                continue;
            }
            if factory_is_missing {
                let location = hir.node(element.tag);
                self.on_failed_to_resolve_symbol(
                    file, location, None, scope, factory, meaning, 2874,
                );
            }
            if let Some(result) = jsx_factory_sym {
                self.check_type_only_jsx_factory(file, j, result);
            }
            for p in element.attrs.iter() {
                if hir[p].kind != PropKind::Spread {
                    self.check_grammar_jsx_expression(file, hir[p].value);
                }
            }
            for child in hir.ids(element.children) {
                self.check_jsx_expression(file, child);
            }
            self.check_explicit_children_attribute(file, e, j);
            if !self.are_jsx_attributes_never_checked(file, e) {
                self.check_spread_overrides(file, element.attrs);
            }
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
                match self.jsx_type(file, hir.node(e), known::IntrinsicElements) {
                    None if no_implicit_any => {
                        self.error_at(at, 7026, &[Arg::Bytes(b"IntrinsicElements")]);
                    }
                    Some(elements)
                        if self.type_of_intrinsic_tag_symbol(elements, name).is_none() =>
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

    /// `onSuccessfullyResolvedSymbol` for `result`, the first name of the factory, which
    /// `markJsxAliasReferenced` resolved at the tag name of `j`: 1361, 1362. An opening fragment is
    /// no expression node, so it is a valid use site.
    fn check_type_only_jsx_factory(&mut self, file: FileId, j: JsxId, result: Sym) {
        let (hir, files) = (self.hir(file), self.files());
        let flags = files.flags(result);
        if !flags.contains(SymFlags::ALIAS) || flags.intersects(SymFlags::VALUE) {
            return;
        }
        let tag = hir[j].tag;
        if is_valid_type_only_alias_use_site(hir, hir.node(tag)) {
            return;
        }
        let type_only = files.type_only_alias_declaration_ex(result, SymFlags::VALUE);
        let Some(type_only) = type_only else {
            return;
        };
        let (name, is_export) = (files.symbol(result).name, type_only.is_export());
        self.aliases_error_about_type_only(
            (file, hir[tag].pos, hir[tag].end),
            if is_export { 1362 } else { 1361 },
            &[Arg::Atom(name)],
            Some((type_only, is_export)),
            name,
        );
    }

    /// `createJsxAttributesTypeFromAttributesProperty`: 2710 for `explicitlySpecifyChildrenAttribute`.
    /// `c.error` reports it, so it is no part of the errors of a candidate, and every path of
    /// `resolveJsxOpeningLikeElement` checks the attributes of an opening element.
    fn check_explicit_children_attribute(&mut self, file: FileId, e: ExprId, j: JsxId) {
        let hir = self.hir(file);
        let jsx = &hir[j];
        let JsxName::Name(name) = self.jsx_children_property_name(file, hir.node(e)) else {
            return;
        };
        let (Some(first), Some(last)) = (jsx.attrs.iter().next(), jsx.attrs.iter().next_back())
        else {
            return;
        };
        // `GetSemanticJsxChildren`
        let is_nothing = |child: ExprId| matches!(hir[child].kind, ExprKind::Missing);
        if hir.ids(jsx.children).all(is_nothing) {
            return;
        }
        let mut explicitly_specify_children_attribute = false;
        for p in jsx.attrs.iter() {
            if hir[p].kind != PropKind::Spread {
                explicitly_specify_children_attribute |=
                    self.member_name(file, hir[p].key) == Some(name);
                continue;
            }
            // `hasSpreadAnyType`
            let ty = self.type_of_expr(file, hir[p].value);
            let ty = self.reduced(ty);
            if self.is_any(ty) {
                return;
            }
        }
        if explicitly_specify_children_attribute {
            let attributes = (file, hir[first].start, hir[last].end);
            self.error_at(attributes, 2710, &[Arg::Atom(name)]);
        }
    }

    /// Whether nothing checks the attributes of the element `e`. `chooseOverload` checks them for
    /// a candidate that takes the type arguments. If there is none,
    /// `getCandidateForOverloadFailure` defers the node, and `checkDeferredNode` goes on to
    /// `resolveUntypedCall` for an opening element, but not for a self-closing one.
    /// `reportCallResolutionErrors` reports at the type arguments only if
    /// `candidatesForArgumentError` is empty.
    pub(super) fn are_jsx_attributes_never_checked(&mut self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        let ExprKind::Jsx(j) = hir[e].kind else {
            return false;
        };
        let type_args = hir[j].type_args;
        let Some(first) = hir.ids(type_args).next() else {
            return false;
        };
        if hir[j].close_pos != u32::MAX {
            return false;
        }
        self.resolved_signature(file, e);
        let list = start_of_type(hir, first)..self.end_of_type_argument_list(file, type_args);
        (self.p.call_diagnostics)
            .get_ref(&self.task, &(file, e))
            .is_some_and(|reported| reported.iter().any(|d| list.contains(&d.start)))
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
            let name = self.atoms().bytes(name);
            if let Some(colon) = bun_core::strings::index_of_char_usize(name, b':')
                && !(name[0].is_ascii_lowercase()
                    || bun_core::strings::contains_char(&name[..colon], b'-'))
            {
                let tag = hir[jsx.tag];
                self.grammar_error_at((file, tag.pos, tag.end), 2639, &[]);
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

    /// `checkGrammarJsxExpression` for an expression in braces.
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

    /// `checkJsxExpression` for a child. A tuple type is not an array type. `t != c.anyType`: the
    /// error type is reported too.
    fn check_jsx_expression(&mut self, file: FileId, child: ExprId) {
        let hir = self.hir(file);
        let ExprKind::Spread(spread) = hir[child].kind else {
            self.check_grammar_jsx_expression(file, child);
            return;
        };
        self.check_grammar_jsx_expression(file, spread);
        let ty = self.type_of_expr(file, spread);
        if ty != TypeId::ANY
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
            (file, hir[jsx.tag].pos, hir[jsx.tag].end)
        };
        let expr_types = if is_jsx_open_fragment {
            self.jsx_fragment_type(file, e)
        } else if let Some(name) = self.jsx_intrinsic_tag_name(file, jsx.tag) {
            let node = self.jsx_opening_like(file, e);
            let result = self.jsx_intrinsic_attributes(file, node, name);
            let result = result.unwrap_or(TypeId::ERROR);
            let fake_signature = self.jsx_intrinsic_signature(file, node, result);
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
            // As in `resolve_call`: expressions checked only to produce an error use the signature.
            self.resolved_meanwhile.push((file, e, resolved));
            let relation = Relation::Assignable;
            let at = Some(error_node);
            self.check_jsx_attributes_related_to(file, e, source, result, relation, at);
            self.resolved_meanwhile.pop();
            if let Some(first) = hir.ids(jsx.type_args).next() {
                let end = self.end_of_type_argument_list(file, jsx.type_args);
                let args = [Arg::Number(0), Arg::Number(jsx.type_args.len())];
                self.error_at((file, start_of_type(hir, first), end), 2558, &args);
            }
            return resolved;
        } else {
            self.type_of_expr(file, jsx.tag)
        };
        // `resolveUntypedCall`, `resolveErrorCall`: the attributes are checked regardless of how
        // the tag resolves.
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
        self.look_at_type_nodes(file, jsx.type_args);
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
            ExpectsReturn::Yes,
            None,
        )
    }

    /// `getContextualJsxElementAttributesType`
    pub(super) fn contextual_jsx_element_attributes_type(
        &mut self,
        file: FileId,
        e: ExprId,
    ) -> Option<TypeId> {
        // `getContextualTypeForJsxExpression`: a child of a fragment has no contextual type.
        let hir = self.hir(file);
        let ExprKind::Jsx(j) = hir[e].kind else {
            return None;
        };
        if hir[j].tag.is_none() {
            return None;
        }
        if let Some(info) = self.find_contextual_node(file, e, true) {
            return info.t;
        }
        // `getContextualTypeForArgumentAtIndex`: `resolvingSignature` is not resolved again. That state belongs to this checker, so it
        // is read from its own query stack. Like `anySignature` and `unknownSignature`, it has no parameters.
        let is_this_element = |r: &(FileId, ExprId, ResolvedCall)| r.0 == file && r.1 == e;
        if !self.resolved_meanwhile.iter().any(is_this_element)
            && self.stack.contains(&Query::Call(file, e))
        {
            let signature = self.any_signature();
            return Some(self.jsx_effective_first_argument(file, e, signature));
        }
        // Cache: queried once per attribute and per child.
        if let Some(cached) = (self.p.jsx_attributes_types).get(&self.task, &(file, j)) {
            return Some(cached);
        }
        let resolved = self.resolved_signature(file, e).sig;
        let signature = resolved.unwrap_or_else(|| self.any_signature());
        let ty = self.jsx_effective_first_argument(file, e, signature);
        // Cacheable only if computed from the cached signature.
        if self.p.calls.get(&self.task, &(file, e)) == Some(resolved) {
            (self.p.jsx_attributes_types).insert(&self.task, (file, j), ty);
        }
        Some(ty)
    }

    /// `isContextSensitive` for `JsxAttributes`. A fragment has none.
    pub(super) fn is_jsx_attributes_context_sensitive(&self, file: FileId, j: JsxId) -> bool {
        let hir = self.hir(file);
        // There is no case for a `JsxSpreadAttribute`.
        let attributes = hir[j].attrs.iter();
        let values = attributes
            .filter(|&p| hir[p].kind != PropKind::Spread)
            .map(|p| hir[p].value);
        // `JsxExpression`, which `{...x}` is too.
        let children = hir.ids(hir[j].children).map(|child| match hir[child].kind {
            ExprKind::Spread(x) => x,
            _ => child,
        });
        hir[j].tag.is_some()
            && values
                .filter(|value| value.is_some())
                .chain(children)
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
    /// the attributes and the children". `is_checked_once`: FOR SPEED, see `CallState::checks_arguments_once` and `cached_arg_type_for_param`.
    fn check_jsx_attributes_with_contextual_type(
        &mut self,
        file: FileId,
        e: ExprId,
        contextual_type: TypeId,
        inference_context: Option<&mut Inference>,
        check_mode: CheckMode,
        is_checked_once: bool,
    ) -> TypeId {
        self.push_contextual_type(file, e, Some(contextual_type), false);
        let ty = if is_checked_once {
            self.inference_contexts.push(InferenceContextInfo {
                file,
                node: e,
                context: None,
            });
            let outer = self.suspend_recheck();
            // `checkJsxAttribute`: each is checked immediately, while its contextual type is
            // pushed. Here they are evaluated lazily when they are read, which is after the pop.
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
        self.pop_contextual_type();
        ty
    }

    /// `checkApplicableSignatureForJsxCallLikeElement`
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
            (file, hir[tag].pos, hir[tag].end)
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

    /// `checkTypeRelatedToAndOptionallyElaborate(source, target, relation, errorNode,
    /// node.Attributes(), ..)` for the element `e`. When undecided they are treated as related,
    /// except in the subtype pass.
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
        if self.related(source, target, relation) {
            return true;
        }
        // `elaborateError`: a fragment has no attributes to elaborate into.
        if error_node.is_some()
            && (hir[j].tag.is_none()
                || self.is_or_has_generic_conditional(target)
                || !self.elaborate_jsx_components(file, e, source, target))
        {
            return self.check_type_related_to_ex(source, target, relation, error_node, None, None);
        }
        false
    }

    /// `isOrHasGenericConditional`
    pub(super) fn is_or_has_generic_conditional(&self, t: TypeId) -> bool {
        match self.data(t) {
            TypeData::Cond { .. } => true,
            TypeData::Intersection(types) => {
                types.iter().any(|&t| self.is_or_has_generic_conditional(t))
            }
            _ => false,
        }
    }

    /// `checkTagNameDoesNotExpectTooManyArguments`: whether every call signature of the tag of `e`
    /// requires more arguments than the JSX factory passes to a function it receives. If so: the
    /// smallest required count, the factory, and the largest count it passes.
    fn jsx_tag_expects_too_many_arguments(
        &mut self,
        file: FileId,
        e: ExprId,
    ) -> Option<(usize, Vec<u8>, usize)> {
        let (hir, files) = (self.hir(file), self.files());
        let ExprKind::Jsx(j) = hir[e].kind else {
            return None;
        };
        // An implicitly imported factory is assumed to be compatible.
        if files
            .jsx_runtime(file)
            .is_some_and(|spec| files.module_of_specifier(file, spec).is_some())
        {
            return None;
        }
        let tag_type = self.type_of_expr(file, hir[j].tag);
        let ways = self.signatures(tag_type, false);
        if ways.is_empty() {
            return None;
        }
        let names = jsx_factory_entity(files, self.atoms(), hir, true);
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
        // The largest argument count with which any function accepted as the first argument is
        // called. `None`: no function is accepted there.
        let mut most: Option<usize> = None;
        for sig in self.signatures(factory_type, false) {
            let params = self.sig_params(sig);
            let first = self.param_type_at(&params, 0).unwrap_or(TypeId::ANY);
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
        let factory: Vec<&[u8]> = names.iter().map(|&name| self.atoms().bytes(name)).collect();
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
            if bun_core::strings::contains_char(self.atoms().bytes(name), b'-') {
                continue;
            }
            let (at, mut diags) = (
                (file, prop.pos, self.end_of_jsx_attr_name(file, p)),
                Vec::new(),
            );
            let output = Some(&mut diags);
            let name_type = self.string_literal(name, false);
            reported |= self.elaborate_element(
                source, target, at, prop.value, false, name_type, None, output,
            );
            // `elaborateDidYouMeanToCallOrConstruct` runs on the braces around the value before it
            // runs on the value: its diagnostic, the only one at the start of the value, is
            // reported at the start of the braces.
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
        // `IsJsxOpeningElement(node.Parent)`
        if hir[j].close_pos == u32::MAX {
            return reported;
        }
        let children_prop_name = match self.jsx_children_property_name(file, hir.node(e)) {
            JsxName::Name(name) => name,
            JsxName::Missing => known::children,
            JsxName::Empty => known::empty,
        };
        let name_type = self.string_literal(children_prop_name, false);
        let children_target_type = self.indexed_access(target, name_type);
        // `GetSemanticJsxChildren`
        let mut valid_children = hir
            .ids(hir[j].children)
            .filter(|&child| !matches!(hir[child].kind, ExprKind::Missing));
        let Some(child) = valid_children.next() else {
            return reported;
        };
        let more_than_one_real_children = valid_children.next().is_some();
        // `getGlobalIterableType() != emptyGenericType`. Where there is no such `Iterable`, a list is
        // an array-like or tuple-like type.
        let has_iterable = self.global_type_of_arity(known::Iterable, 3).is_some();
        let any_iterable = self.global_ref(
            known::Iterable,
            &[TypeId::ANY, TypeId::VOID, TypeId::UNDEFINED],
        );
        let is_list = |c: &mut Self, t: TypeId| {
            if has_iterable {
                c.is_assignable(t, any_iterable)
            } else {
                c.is_array_like(t) || c.is_tuple_like(t)
            }
        };
        let array_like_target_parts = self.filter(children_target_type, |c, t| is_list(c, t));
        let non_array_like_target_parts = self.filter(children_target_type, |c, t| !is_list(c, t));
        let expected = (children_prop_name, children_target_type);
        let arity_mismatch = if more_than_one_real_children {
            if array_like_target_parts != TypeId::NEVER {
                let child_types: Vec<TypeId> = (self.jsx_child_types(file, e).iter())
                    .map(|child| child.1)
                    .collect();
                let flags = vec![ElemFlags::REQUIRED; child_types.len()];
                let real_source = self.tuple(&child_types, &flags, false);
                let children = self.generate_jsx_children(file, j);
                let elaborated = self.elaborate_iterable_or_array_like_target_elementwise(
                    file,
                    e,
                    &children,
                    real_source,
                    array_like_target_parts,
                    expected,
                );
                return elaborated || reported;
            }
            2746
        } else {
            if non_array_like_target_parts != TypeId::NEVER {
                let element = get_elaboration_element_for_jsx_child(hir, child, name_type);
                let at = element.error_node;
                let (prop, next) = ((file, at.0, at.1), element.inner_expression);
                let mut diags = Vec::new();
                let output = element.is_text.then_some(&mut diags);
                let elaborated = self
                    .elaborate_element(source, target, prop, next, false, name_type, None, output);
                // `diagnosticFactory`: the diagnostic about text takes the place of the one about
                // the two types.
                for replaced in diags {
                    let mut diagnostic =
                        self.invalid_textual_child_diagnostic(file, e, at, expected);
                    diagnostic.related_information = replaced.related_information;
                    self.add_diagnostic(diagnostic);
                }
                return elaborated || reported;
            }
            2745
        };
        let children_source_type = self.indexed_access(source, name_type);
        if self.is_assignable(children_source_type, children_target_type) {
            return reported;
        }
        let tag = hir[hir[j].tag];
        let args = [
            Arg::Atom(children_prop_name),
            Arg::Type(children_target_type),
        ];
        let diagnostic = self.new_diagnostic((file, tag.pos, tag.end), arity_mismatch, &args);
        // `c.error` reports it by itself, and `reportDiagnostic` among the errors of the candidate.
        (self.call_resolution_errors.get_or_insert_default()).push(diagnostic.clone());
        self.add_diagnostic(diagnostic);
        true
    }

    /// `getInvalidTextualChildDiagnostic` for the text from `start` to `end` in the element `e`.
    /// `expected`: the name of the children attribute, and the type the tag accepts for it.
    fn invalid_textual_child_diagnostic(
        &mut self,
        file: FileId,
        e: ExprId,
        (start, end): (u32, u32),
        expected: (Atom, TypeId),
    ) -> Reported {
        let hir = self.hir(file);
        let ExprKind::Jsx(j) = hir[e].kind else {
            unreachable!()
        };
        let tag = text_of(hir, hir[hir[j].tag].pos, hir[hir[j].tag].end);
        let args = [
            Arg::Bytes(tag),
            Arg::Atom(expected.0),
            Arg::Type(expected.1),
        ];
        self.new_diagnostic((file, start, end), 2747, &args)
    }

    /// `generateJsxChildren`. Text of white space only, which raises `memberOffset`, is not stored
    /// among the children.
    fn generate_jsx_children(&self, file: FileId, j: JsxId) -> Vec<JsxElaborationElement> {
        let hir = self.hir(file);
        let children = hir.ids(hir[j].children).enumerate();
        children
            .map(|(i, child)| {
                let name_type = self.number_literal(i as f64, false);
                get_elaboration_element_for_jsx_child(hir, child, name_type)
            })
            .collect()
    }

    /// `elaborateIterableOrArrayLikeTargetElementwise` for the children of `e`.
    /// `expected`: the name of the children attribute, and the whole type the tag accepts for it.
    fn elaborate_iterable_or_array_like_target_elementwise(
        &mut self,
        file: FileId,
        e: ExprId,
        iterator: &[JsxElaborationElement],
        source: TypeId,
        target: TypeId,
        expected: (Atom, TypeId),
    ) -> bool {
        // `isArrayOrTupleLikeType`
        let arrays = self.filter(target, |c, t| c.is_array_like(t) || c.is_tuple_like(t));
        let iterables = self.filter(target, |c, t| !(c.is_array_like(t) || c.is_tuple_like(t)));
        // `getIterationTypeOfIterable`
        let iteration_type = if iterables == TypeId::NEVER || self.is_any(iterables) {
            None
        } else {
            self.iterable_types(iterables, IterationUse::ForOf, None).y
        };
        let mut reported_error = false;
        for element in iterator {
            let (next, name_type) = (element.inner_expression, element.name_type);
            let prop = (file, element.error_node.0, element.error_node.1);
            let target_indexed_prop_type = if arrays == TypeId::NEVER {
                None
            } else {
                self.get_best_match_indexed_access_type_or_undefined(source, arrays, name_type)
                    .filter(|&t| !matches!(self.data(t), TypeData::IndexedAccess { .. }))
            };
            let target_prop_type = match (iteration_type, target_indexed_prop_type) {
                (Some(a), Some(b)) => self.union(&[a, b]),
                (Some(a), None) | (None, Some(a)) => a,
                (None, None) => continue,
            };
            let source_prop_type = self.indexed_access_if_any(source, name_type, false);
            let Some(source_prop_type) = source_prop_type else {
                continue;
            };
            if self.is_assignable(source_prop_type, target_prop_type) {
                continue;
            }
            reported_error = true;
            if next.is_some()
                && self.elaborate_error(
                    file,
                    next,
                    false,
                    source_prop_type,
                    target_prop_type,
                    None,
                    None,
                )
            {
                continue;
            }
            let specific_source = if next.is_some() {
                self.check_expression_for_mutable_location_with_contextual_type(
                    file,
                    next,
                    source_prop_type,
                )
            } else {
                source_prop_type
            };
            if element.is_text {
                let diagnostic =
                    self.invalid_textual_child_diagnostic(file, e, element.error_node, expected);
                self.add_diagnostic(diagnostic);
            } else if self.is_exact_optional_property_mismatch(specific_source, target_prop_type) {
                let args = [Arg::Type(specific_source), Arg::Type(target_prop_type)];
                self.error_at(prop, 2412, &args);
            } else {
                let prop_name = self.property_name_of_type(name_type);
                let is_optional_in = |c: &mut Self, t: TypeId| {
                    prop_name
                        .and_then(|name| c.get_property_of_type(t, name))
                        .is_some_and(|(prop, _)| prop.flags.contains(PropFlags::OPTIONAL))
                };
                let target_is_optional = is_optional_in(self, arrays);
                let source_is_optional = is_optional_in(self, source);
                let target_prop_type =
                    self.remove_missing_type(target_prop_type, target_is_optional);
                let source_prop_type = self.remove_missing_type(
                    source_prop_type,
                    target_is_optional && source_is_optional,
                );
                let at = Some(prop);
                if self.check_type_assignable_to(specific_source, target_prop_type, at, None)
                    && specific_source != source_prop_type
                {
                    self.check_type_assignable_to(source_prop_type, target_prop_type, at, None);
                }
            }
        }
        reported_error
    }

    /// `getBestMatchIndexedAccessTypeOrUndefined`
    pub(super) fn get_best_match_indexed_access_type_or_undefined(
        &mut self,
        source: TypeId,
        target: TypeId,
        name_type: TypeId,
    ) -> Option<TypeId> {
        if let Some(idx) = self.indexed_access_if_any(target, name_type, false) {
            return Some(idx);
        }
        if !self.is_union(target) {
            return None;
        }
        let best = self.best_matching_type(source, target, &mut |c, s, t| c.is_assignable(s, t))?;
        self.indexed_access_if_any(best, name_type, false)
    }

    /// `checkSpreadPropOverrides`: 2783 for a property that is overwritten by a later spread.
    pub(super) fn check_spread_overrides(&mut self, file: FileId, props: Span<PropId>) {
        let hir = self.hir(file);
        if !self.p.files.options.strict_null_checks
            || !props.iter().any(|p| hir[p].kind == PropKind::Spread)
        {
            return;
        }
        // `allPropertiesTable`, which excludes accessors: `prop.Name` and `prop.ValueDeclaration`,
        // which is that of the symbol all declarations of the name share.
        let mut written: Vec<(Atom, PropId)> = Vec::new();
        for p in props.iter() {
            let prop = &hir[p];
            if prop.kind != PropKind::Spread {
                if matches!(
                    prop.kind,
                    PropKind::Init | PropKind::Shorthand | PropKind::Method
                ) && let Some(name) = self.member_name(file, prop.key)
                {
                    let value_declaration = self.first_declaration_of_literal_member(file, p);
                    written.retain(|w| w.0 != name);
                    written.push((name, value_declaration));
                }
                continue;
            }
            if written.is_empty() {
                continue;
            }
            let ty = self.type_of_expr(file, prop.value);
            let ty = self.reduced(ty);
            if self.is_any(ty) || !self.is_valid_spread_type(ty) {
                continue;
            }
            // `tryMergeUnionOfObjectTypeAndEmptyObject`
            let merged = self.try_merge_union_of_object_type_and_empty_object(ty);
            let parts = self.parts(merged);
            for &(name, overwritten) in &written {
                // Neither optional nor partial: every constituent is guaranteed to have it.
                let mut always = !parts.is_empty();
                for &part in parts {
                    let apparent = self.apparent_type(part);
                    for &alternative in self.parts(apparent) {
                        always = always
                            && self
                                .prop_ref(alternative, name)
                                .is_some_and(|(p, _)| !p.flags.contains(PropFlags::OPTIONAL));
                    }
                }
                if always {
                    // The spread starts at its `...`, that of an attribute at the `{`.
                    let spread = (file, prop.start, self.end_of_prop(file, p));
                    let spread = self.new_diagnostic(spread, 2785, &[]);
                    self.error(file, overwritten, 2783, &[Arg::Atom(name)])
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
        let at = (file, hir[tag].pos, hir[tag].end);
        let intrinsic = self.jsx_intrinsic_tag_name(file, tag);
        let mut diags = Vec::new();
        let node = self.jsx_opening_like(file, e);
        // `JSX.ElementType`, if it exists, is the only constraint.
        if let Some(allowed) = self.jsx_element_type_constraint(file, node) {
            let actual = match intrinsic {
                Some(name) => self.string_literal(name, false),
                None => self.type_of_expr(file, tag),
            };
            let output = Some(&mut diags);
            self.check_type_assignable_to_ex(actual, allowed, Some(at), Some(18053), output);
        } else if intrinsic.is_none() {
            let elem_instance_type = self.resolved_signature(file, e).ret;
            let ref_kind = self.jsx_reference_kind(file, tag);
            let diags = &mut diags;
            self.check_jsx_return_assignable_to_appropriate_bound(
                ref_kind,
                elem_instance_type,
                node,
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

    /// `checkJsxReturnAssignableToAppropriateBound`, up to the handling of `diags`.
    fn check_jsx_return_assignable_to_appropriate_bound(
        &mut self,
        ref_kind: JsxReferenceKind,
        elem_instance_type: TypeId,
        opening_like_element: Node,
        tag_name: (FileId, u32, u32),
        diags: &mut Vec<Reported>,
    ) {
        // `getJsxStatelessElementTypeAt`, `getJsxElementClassTypeAt`
        let file = tag_name.0;
        let element = self.jsx_type(file, opening_like_element, known::Element);
        let sfc_return_constraint = element.map(|element| self.union(&[element, TypeId::NULL]));
        let class_constraint = self.jsx_type(file, opening_like_element, known::ElementClass);
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
pub(super) fn jsx_namespace(
    files: &Files,
    atoms: Atoms<'_, '_>,
    hir: &hir::File,
    is_opening_fragment: bool,
) -> Atom {
    if is_opening_fragment {
        // `getJsxFragmentFactoryEntity`: a `@jsxFrag` pragma overrides `jsxFragmentFactory` even if
        // the pragma does not parse.
        let pragma = hir.jsx_pragmas.fragment_factory;
        let text = if pragma.is_some() {
            atoms.bytes(pragma)
        } else {
            &files.options.jsx_fragment_factory
        };
        if let Some(entity) = parse_isolated_entity_name(atoms, text) {
            return entity[0];
        }
    }
    jsx_factory_entity(files, atoms, hir, !is_opening_fragment)[0]
}

/// `getJsxFactoryEntity`, returned as its identifiers from left to right. `is_local`:
/// `localJsxFactory` is considered, which is the `@jsx` pragma if it parses.
fn jsx_factory_entity(
    files: &Files,
    atoms: Atoms<'_, '_>,
    hir: &hir::File,
    is_local: bool,
) -> Vec<Atom> {
    let options = &files.options;
    let pragma = hir.jsx_pragmas.factory;
    if is_local
        && pragma.is_some()
        && let Some(entity) = parse_isolated_entity_name(atoms, atoms.bytes(pragma))
    {
        return entity;
    }
    // `_jsxFactoryEntity`: `reactNamespace` is read only if `jsxFactory` is not set, and is used
    // verbatim.
    parse_isolated_entity_name(atoms, &options.jsx_factory).unwrap_or_else(|| {
        let namespace = if options.jsx_factory.is_empty() && !options.react_namespace.is_empty() {
            atoms.intern(&options.react_namespace)
        } else {
            known::React
        };
        vec![namespace, atoms.intern(b"createElement")]
    })
}

/// `parseIsolatedEntityName`, returned as the identifiers of the name. Empty text is not a name.
fn parse_isolated_entity_name(atoms: Atoms<'_, '_>, text: &[u8]) -> Option<Vec<Atom>> {
    let entity = crate::verify::parse_isolated_entity_name(text)?;
    Some(entity.iter().map(|name| atoms.intern(name)).collect())
}

fn text_of<'a>(hir: &'a hir::File<'_>, start: u32, end: u32) -> &'a [u8] {
    &hir.text[start as usize..end as usize]
}

/// Whether the `child` of an element is `JsxText`: a string that is not in braces.
fn is_jsx_text(hir: &hir::File, child: ExprId) -> bool {
    matches!(hir[child].kind, ExprKind::String(_)) && jsx_expression_around(hir, child).is_none()
}

/// The span of the `child` of an element, including its braces if it has any.
fn range_of_jsx_child(hir: &hir::File, child: ExprId) -> (u32, u32) {
    jsx_expression_around(hir, child).unwrap_or((hir[child].pos, hir[child].end))
}

/// `JsxElaborationElement`
#[derive(Copy, Clone)]
struct JsxElaborationElement {
    /// The span of `errorNode`.
    error_node: (u32, u32),
    /// `NONE`: there is none.
    inner_expression: ExprId,
    name_type: TypeId,
    /// `createDiagnostic != nil`
    is_text: bool,
}

/// `getElaborationElementForJsxChild`
fn get_elaboration_element_for_jsx_child(
    hir: &hir::File,
    child: ExprId,
    name_type: TypeId,
) -> JsxElaborationElement {
    let is_text = is_jsx_text(hir, child);
    let inner_expression = match hir[child].kind {
        // `{}`
        ExprKind::Missing => ExprId::NONE,
        ExprKind::String(_) if is_text => ExprId::NONE,
        // `{...x}`
        ExprKind::Spread(x) => x,
        _ => child,
    };
    JsxElaborationElement {
        error_node: range_of_jsx_child(hir, child),
        inner_expression,
        name_type,
        is_text,
    }
}

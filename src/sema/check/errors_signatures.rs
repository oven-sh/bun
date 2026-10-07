//! Signatures.
//!
//! * Type parameters: 2368 2716 2706 2744 2636 2637, and 2344 (or a more specific error) for a
//!   default that does not satisfy the constraint of the parameter.
//! * Parameter lists: 1098, 1014 1013 1047 1048 1015 1016, 1346 1347, 7060 1200; parameters: 2398
//!   2681 2784.
//! * Accessors, methods, constructors, properties: 1005 1318, 1221 1222, 1092 1093, 1245 1267, 2676
//!   2808.
//! * Return types: 2505 1064 1058 1062, 1228 1229 2677 1230 1225.
//! * `erasableSyntaxOnly`: 1294.
//!
//! Follows `checkTypeParameter`, `checkTypeParameterDeferred`, `checkTypeParameters`,
//! `checkTypeParametersNotReferenced`, `checkParameter`, `checkPropertyDeclaration`,
//! `checkSignatureDeclaration`, `checkAsyncFunctionReturnType`, `checkMethodDeclaration`,
//! `checkAccessorDeclaration`, `checkTypePredicate`, `getAwaitedTypeNoAliasEx` and
//! `checkAssertion` of TypeScript 7.0.2's checker.go,
//! `checkGrammarTypeParameterList`, `checkGrammarParameterList`,
//! `checkGrammarForUseStrictSimpleParameterList`, `checkGrammarArrowFunction`,
//! `checkGrammarForGenerator`, `checkGrammarAccessor`, `checkGrammarMethod` and
//! `checkGrammarConstructorTypeParameters` of its grammarchecks.go.
//!
//! The HIR of a file does not store everything these checks need: a body where none is allowed, a
//! `this` parameter, `"use strict"`, the position of a `?` or a modifier. That is read from the
//! source text, starting at a position the HIR does have.

use super::*;
use crate::bind::{FnOwner, MemberOwner};

// ───────────────────────────── the grammar of signatures ─────────────────────────────

impl Checker<'_, '_> {
    // ───────────────────────────── type parameters ─────────────────────────────

    /// `checkTypeParameter`, from `getResolvedTypeParameterDefault` to the comparison of the
    /// default with the constraint: 2716, 2344. `param`: the type parameter that `tp` declares.
    pub(super) fn check_type_parameter_default(
        &mut self,
        file: FileId,
        tp: TypeParamId,
        param: TypeId,
    ) {
        let hir = self.hir(file);
        // `tpNode.DefaultType`. `None`: only another declaration of the class or interface has it.
        let error_node = hir[tp].default.some().map(|default_type| {
            let start = start_of_type(hir, default_type);
            let end = self.end_of_type_node_from(file, default_type, start);
            (file, start, end)
        });
        let Some(default) = self.default_of_type_param(param) else {
            if self.has_circular_default(param) {
                match error_node {
                    Some(at) => {
                        self.error_at(at, 2716, &[Arg::Type(param)]);
                    }
                    // An error at no node is in no file.
                    None => {
                        let name = self.type_to_string(param);
                        self.report_global_error(2716, vec![name]);
                    }
                }
            }
            return;
        };
        let Some(constraint) = self.constraint_of_type_param(param) else {
            return;
        };
        let mapper = self.mapper_from(&[param], &[default]);
        let constraint = self.instantiate(constraint, mapper);
        let constraint = self.type_with_this_argument(constraint, default);
        self.check_type_assignable_to(default, constraint, error_node, Some(2344));
    }

    /// `checkTypeParameterDeferred` for the type parameters `params` of a declaration of the class,
    /// interface or type alias `symbol`: 2637, 2636.
    pub(super) fn check_type_parameters_deferred(
        &mut self,
        file: FileId,
        symbol: crate::bind::SymbolId,
        params: Span<TypeParamId>,
        is_alias: bool,
    ) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let is_annotated = |tp: TypeParamId| hir[tp].flags.intersects(Flags::IN | Flags::OUT);
        // If the only declaration has no annotations, there are none.
        if symbol.is_none()
            || !params.iter().any(is_annotated)
                && bound.symbols[symbol.idx()].decls.len() == 1
                && !bound.symbols[symbol.idx()].flags.contains(SymFlags::MERGED)
        {
            return;
        }
        let sym = self.files().sym(file, symbol);
        let declared = self.declared_type(sym);
        // A reference to a class or an interface lists the outer type parameters first.
        let all = if is_alias {
            self.type_params_of_symbol(sym)
        } else {
            self.all_type_params_of_symbol(sym)
        };
        for tp in params.iter() {
            let decl = &hir[tp];
            // The declarations share their type parameters, by name. An outer one may have the same name.
            let index = all.iter().rposition(|&p| {
                self.type_param_decl(p)
                    .is_some_and(|(_, d)| d.name == decl.name)
            });
            let Some(index) = index else { continue };
            let own = all[index];
            let modifiers = self.type_param_modifiers(sym, own) & (Flags::IN | Flags::OUT);
            if modifiers.is_empty() {
                continue;
            }
            let start = decl.start;
            // `ObjectFlagsAnonymous | ObjectFlagsMapped`
            if is_alias
                && !matches!(
                    self.data(declared),
                    TypeData::Anon { .. } | TypeData::Fns { .. } | TypeData::Synth(_)
                )
            {
                // A missing name has an empty span at the end of the previous token.
                let is_nameless = (decl.name == known::empty || decl.name.is_none())
                    && decl.constraint.is_none()
                    && decl.default.is_none();
                let end = if !is_nameless {
                    self.end_of_type_param(file, tp)
                } else if start == decl.pos {
                    super::explain::NO_LENGTH
                } else {
                    decl.pos
                };
                self.error_at((file, start, end), 2637, &[]);
                continue;
            }
            if modifiers == Flags::IN | Flags::OUT {
                continue;
            }
            // The check has its own markers, so a variance measurement never reuses a relation cached here.
            let sub = self.create_marker_type(sym, &all, index, TypeId::MARKER_SUB_FOR_CHECK);
            let sup = self.create_marker_type(sym, &all, index, TypeId::MARKER_SUPER_FOR_CHECK);
            let (source, target) = if modifiers == Flags::OUT {
                (sub, sup)
            } else {
                (sup, sub)
            };
            // `reportUnreliableWorker` ignores these markers. `report_unreliable` fires on every marker, so its flags are dropped.
            let reliability = self.reliability;
            // `c.varianceTypeParameter`: the markers are printed with its name while this
            // diagnostic is formatted.
            self.set_variance_type_parameter(Some(own));
            let at = (file, start, self.end_of_type_param(file, tp));
            // `checkDeferredNode`: `c.currentNode = node`, `c.instantiationCount = 0`
            let node = CurrentNode::Node(file, hir.node(tp));
            let saved = self.current_source_element.replace(node);
            let instantiation_count = std::mem::take(&mut self.instantiation_count);
            self.check_type_assignable_to(source, target, Some(at), Some(2636));
            self.instantiation_count = instantiation_count;
            self.current_source_element = saved;
            self.set_variance_type_parameter(None);
            self.reliability = reliability;
        }
    }

    // ───────────────────────────── signatures ─────────────────────────────

    /// Whether `f` is a member of a class or of an object literal, as opposed to one of an interface or a type literal.
    fn is_member_that_may_have_body(&self, file: FileId, f: FnId) -> bool {
        let bound = self.bound(file);
        match bound.fns[f.idx()].owner {
            FnOwner::Member(m) => matches!(bound.member_owner[m.idx()], MemberOwner::Class(_)),
            FnOwner::Expr(_) => true,
            _ => false,
        }
    }

    // ───────────────────────────── return types ─────────────────────────────

    /// `checkTypePredicate`: 1228, 1229, 2677, 1230, 1225.
    pub(super) fn check_type_predicate(&mut self, file: FileId, node: TypeNodeId) {
        let hir = self.hir(file);
        let TypeNodeKind::Predicate { param, ty, asserts } = hir[node].kind else {
            return;
        };
        let text = &hir.text[..];
        // `getTypePredicateParent`. A `ParenthesizedType`, which has no node, is no such parent.
        let parent = hir
            .function_of(hir.parent(hir.node(node)))
            .some()
            .filter(|&f| {
                hir[f].ret == node
                    && (self.parenthesized_types_around(file, node, hir[f].start))
                        .next()
                        .is_none()
                    && matches!(
                        hir[f].kind,
                        FnKind::Arrow
                            | FnKind::CallSignature
                            | FnKind::Decl
                            | FnKind::Expr
                            | FnKind::FunctionType
                            | FnKind::Method
                    )
            });
        let Some(parent) = parent else {
            self.error(file, node, 1228, &[]);
            return;
        };
        // `getTypePredicateOfSignature` resolves the type before `checkSourceElement` visits its
        // parts.
        self.type_from_node(file, ty);
        self.check_type_node(file, ty);
        if param == known::this {
            return;
        }
        // The parameter name is the first word of the node, or the one after `asserts`.
        let start = hir[node].pos;
        let name_pos = if asserts {
            skip_trivia(text, start as usize + b"asserts".len()) as u32
        } else {
            start
        };
        let params = hir[parent].params;
        let Some(index) = params
            .iter()
            .position(|p| matches!(hir[hir[p].pat].kind, PatKind::Ident(name) if name == param))
        else {
            // `checkIfTypePredicateVariableIsDeclaredInBindingPattern`
            let mut names = Vec::new();
            params
                .iter()
                .for_each(|p| names_bound_by(hir, hir[p].pat, &mut names));
            let is_in_pattern = names.iter().any(|&(name, _)| name == param);
            self.error_at(
                (file, name_pos, 0),
                if is_in_pattern { 1230 } else { 1225 },
                &[Arg::Atom(param)],
            );
            return;
        };
        let p = params.at(index);
        if hir[p].flags.contains(Flags::REST) && index == params.len() - 1 {
            self.error_at((file, name_pos, 0), 1229, &[]);
            return;
        }
        if ty.is_none() {
            return;
        }
        if hir[p].ty.is_none() {
            self.prepare_fn(file, parent);
        }
        let (narrowed, declared) = (self.type_from_node(file, ty), self.type_of_param(file, p));
        let start = start_of_type(hir, ty);
        let at = (file, start, self.end_of_type_node_from(file, ty, start));
        let mut diags = Vec::new();
        if !self.check_type_assignable_to_ex(narrowed, declared, Some(at), None, Some(&mut diags)) {
            let diagnostic = self.new_diagnostic_chain(diags.pop(), at, 2677, &[]);
            self.add_diagnostic(diagnostic);
        }
    }

    /// From `checkSignatureDeclaration`: 2505.
    pub(super) fn check_generator_return_type(&mut self, file: FileId, f: FnId) {
        let hir = self.hir(file);
        let func = &hir[f];
        if !func.flags.contains(Flags::GENERATOR) || func.ret.is_none() {
            return;
        }
        let is_declaration = matches!(func.kind, FnKind::Decl | FnKind::Expr)
            || func.kind == FnKind::Method && self.is_member_that_may_have_body(file, f);
        if is_declaration && has_body(func) && self.type_from_node(file, func.ret) == TypeId::VOID {
            let start = start_of_type(hir, func.ret);
            let end = self.end_of_type_node_from(file, func.ret, start);
            self.error_at((file, start, end), 2505, &[]);
        }
    }

    /// `checkAsyncFunctionReturnType`: 1064, or 1058 1062.
    pub(super) fn check_async_function_return_type(&mut self, file: FileId, f: FnId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let func = &hir[f];
        if func.ret.is_none()
            || !func.flags.contains(Flags::ASYNC)
            || func.flags.contains(Flags::GENERATOR)
            || matches!(bound.fns[f.idx()].owner, FnOwner::None)
            || !(matches!(func.kind, FnKind::Decl | FnKind::Expr | FnKind::Arrow)
                || func.kind == FnKind::Method && self.is_member_that_may_have_body(file, f))
        {
            return;
        }
        let ret = self.type_from_node(file, func.ret);
        if self.is_error_type(ret) {
            return;
        }
        // `getGlobalPromiseTypeChecked`
        if self.get_global_type(known::Promise, 1, true).is_some()
            && self.is_global_ref(ret, known::Promise, 1).is_none()
        {
            let start = start_of_type(hir, func.ret);
            let end = self.end_of_type_node_from(file, func.ret, start);
            let awaited = self.awaited_no_alias(ret).unwrap_or(TypeId::VOID);
            self.error_at((file, start, end), 1064, &[Arg::Type(awaited)]);
            return;
        }
        self.check_awaited_type(
            ret,
            false,
            self.place_of_signature_declaration(file, f),
            1058,
        );
    }
}

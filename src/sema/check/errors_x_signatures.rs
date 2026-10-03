//! Signatures.
//!
//! * Type parameters: 2368 2716 2706 2744 2636 2637, and 2344 (or what says more) for a default that is not what the parameter extends.
//! * Parameter lists: 1098, 1014 1013 1047 1048 1015 1016, 1346 1347, 7060 1200; parameters: 2398 2681 2784.
//! * Accessors, methods, constructors, properties: 1005 1318, 1221 1222, 1092 1093, 1245 1267, 2676 2808.
//! * Return types: 2505 1064 1058 1062, 2705 2712, 1228 1229 2677 1230 1225.
//! * `erasableSyntaxOnly`: 1294.
//!
//! Follows `checkTypeParameter`, `checkTypeParameterDeferred`, `checkTypeParameters`, `checkTypeParametersNotReferenced`, `checkParameter`,
//! `checkPropertyDeclaration`, `checkSignatureDeclaration`, `checkAsyncFunctionReturnType`, `checkMethodDeclaration`,
//! `checkAccessorDeclaration`, `checkTypePredicate`,
//! `createPromiseReturnType`, `getAwaitedTypeNoAliasEx` and `checkAssertion` of TypeScript 7.0.2's checker.go,
//! `checkGrammarTypeParameterList`, `checkGrammarParameterList`, `checkGrammarForUseStrictSimpleParameterList`,
//! `checkGrammarArrowFunction`, `checkGrammarForGenerator`, `checkGrammarAccessor`, `checkGrammarMethod` and
//! `checkGrammarConstructorTypeParameters` of its grammarchecks.go.
//!
//! The summary of a file does not keep everything these ask about: a body where none belongs, a `this` parameter, `"use strict"`, where a
//! `?` or a modifier is. That is read from the text, from a place the summary does have.

use super::*;
use crate::bind::{FnOwner, MemberOwner};
use crate::util::FxHashSet;

// ───────────────────────────── the text ─────────────────────────────

/// Where the type the summary has at `pos` starts as it is written. Neither the parentheses around a type are kept nor a `|` or a `&`
/// before its only member. Only for a type that follows a `:`, a `=`, an `is` or a `<`, which none of these can be mistaken for.
pub(super) fn start_of_written_type(text: &[u8], pos: u32) -> u32 {
    let mut start = pos as usize;
    if start > text.len() {
        return pos;
    }
    loop {
        let before = skip_trivia_back(text, start);
        if before == 0 || !matches!(text[before - 1], b'(' | b'|' | b'&') {
            return start as u32;
        }
        start = before - 1;
    }
}

/// Where the type alias, class, interface or function declaration that has the type parameter `tp` is named.
fn name_of_type_parameter_owner(hir: &hir::File, tp: TypeParamId) -> Option<u32> {
    let has = |list: Span<TypeParamId>| list.range().contains(&tp.idx());
    let alias = hir.aliases.iter().find(|a| has(a.type_params));
    let class = hir
        .classes
        .iter()
        .find(|c| has(c.type_params) && c.name.is_some());
    let interface = hir.interfaces.iter().find(|i| has(i.type_params));
    let function = hir
        .fns
        .iter()
        .find(|f| has(f.type_params) && f.kind == FnKind::Decl && f.name.is_some());
    alias
        .map(|a| a.name_pos)
        .or_else(|| class.map(|c| c.name_pos))
        .or_else(|| interface.map(|i| i.name_pos))
        .or_else(|| function.map(|f| f.name_pos))
}

// ───────────────────────────── the grammar of signatures ─────────────────────────────

impl Checker<'_> {
    pub(super) fn check_x_signatures(&mut self, file: FileId) {
        self.check_type_parameter_declarations(file);
        self.check_promise_constructor_is_there(file);
    }

    // ───────────────────────────── type parameters ─────────────────────────────

    /// `checkTypeParameter`: 2716, 2344.
    fn check_type_parameter_declarations(&mut self, file: FileId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if !hir.type_params.iter().any(|p| p.default.is_some()) {
            return;
        }
        // In the order they are written: which parameter of a circle is the one to blame depends on where the circle is entered.
        let mut order: Vec<usize> = (0..hir.type_params.len())
            .filter(|&i| bound.type_param_symbol[i].is_some())
            .collect();
        order.sort_by_key(|&i| hir.type_params[i].pos);
        let mut resolution = DefaultResolution::default();
        for i in order {
            let (tp, decl) = (TypeParamId(i as u32), &hir.type_params[i]);
            self.work_out_written_type(file, decl.constraint, &mut resolution, 0);
            self.work_out_written_type(file, decl.default, &mut resolution, 0);
            if decl.default.is_some() {
                self.resolve_type_parameter_default((file, tp), &mut resolution, 0);
                let start = start_of_written_type(&hir.text, hir[decl.default].pos);
                if resolution.states.get(&(file, tp)) == Some(&DefaultState::Circular) {
                    let end = self.end_of_type_node_from(file, decl.default, start);
                    {
                        let param = self.type_param(file, tp);
                        self.error_at((file, start, end), 2716, &[Arg::Type(param)]);
                    }
                } else {
                    // `getConstraintOfTypeParameter`: another declaration of a merged class or interface may write the constraint.
                    let param = self.type_param(file, tp);
                    if let (Some(constraint), Some(default)) = (
                        self.constraint_of_type_param(param),
                        self.default_of_type_param(param),
                    ) {
                        let mapper = self.mapper_from(&[param], &[default]);
                        let constraint = self.instantiate(constraint, mapper);
                        let constraint = self.type_with_this_argument(constraint, default);
                        self.relations_too_deep.clear();
                        let at = (
                            file,
                            start,
                            self.end_of_type_node_from(file, decl.default, start),
                        );
                        self.check_type_assignable_to(default, constraint, Some(at), Some(2344));
                        // `checkTypeRelatedToEx`: a comparison without an error node reports at `currentNode`, the declaration.
                        let too_deep = std::mem::take(&mut self.relations_too_deep);
                        if let Some(start) = name_of_type_parameter_owner(hir, tp) {
                            for (source, target) in too_deep {
                                let at = self.place_of_token(file, start);
                                self.error_at(at, 2321, &[Arg::Type(source), Arg::Type(target)]);
                            }
                        }
                        // Printing compares too.
                        self.relations_too_deep.clear();
                    }
                }
            }
        }
    }

    /// `getResolvedTypeParameterDefault`: one that is asked for while it is being worked out is circular.
    fn resolve_type_parameter_default(
        &mut self,
        param: (FileId, TypeParamId),
        resolution: &mut DefaultResolution,
        depth: u32,
    ) {
        if let Some(state) = resolution.states.get_mut(&param) {
            if *state == DefaultState::Resolving {
                *state = DefaultState::Circular;
            }
            return;
        }
        resolution.states.insert(param, DefaultState::Resolving);
        let default = self.hir(param.0)[param.1].default;
        self.work_out_written_type(param.0, default, resolution, depth + 1);
        if let Some(state) = resolution.states.get_mut(&param)
            && *state == DefaultState::Resolving
        {
            *state = DefaultState::Resolved;
        }
    }

    /// `getTypeFromTypeNode`, for the defaults of type parameters it asks for: those a generic type is named without arguments for
    /// (`fillMissingTypeArguments`). Only what is looked into at once counts: not what is in an object type or a function type, nor
    /// what a type alias stands for, where such a reference waits until it is needed.
    fn work_out_written_type(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        resolution: &mut DefaultResolution,
        depth: u32,
    ) {
        if node.is_none() || depth > 64 || resolution.done.contains(&(file, node)) {
            return;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        match hir[node].kind {
            TypeNodeKind::Union(list) | TypeNodeKind::Intersection(list) => {
                for t in hir.ids(list) {
                    self.work_out_written_type(file, t, resolution, depth + 1);
                }
            }
            TypeNodeKind::Array(t)
            | TypeNodeKind::Keyof(t)
            | TypeNodeKind::Readonly(t)
            | TypeNodeKind::JSDoc { ty: t, .. } => {
                self.work_out_written_type(file, t, resolution, depth + 1)
            }
            TypeNodeKind::Tuple(elems) => {
                for e in elems.iter() {
                    self.work_out_written_type(file, hir[e].ty, resolution, depth + 1);
                }
            }
            TypeNodeKind::IndexedAccess { obj, index } => {
                self.work_out_written_type(file, obj, resolution, depth + 1);
                self.work_out_written_type(file, index, resolution, depth + 1);
            }
            TypeNodeKind::Ref { name, args } => {
                for t in hir.ids(args) {
                    self.work_out_written_type(file, t, resolution, depth + 1);
                }
                let names: Vec<Atom> = hir.texts(name).collect();
                let sym = self.files().resolve_entity(
                    file,
                    bound.type_scope[node.idx()],
                    &names,
                    SymFlags::TYPE,
                );
                if let Some(sym) = sym.and_then(|sym| self.files().resolve_alias_if_needed(sym)) {
                    let (least, most) = self.type_argument_arity(sym);
                    if (least..=most).contains(&args.len()) {
                        let params = self.type_params_of_symbol(sym);
                        for &param in params.iter().skip(args.len()) {
                            if let TypeData::TypeParam(of, tp, _) = *self.data(param) {
                                self.resolve_type_parameter_default(
                                    (of, tp),
                                    resolution,
                                    depth + 1,
                                );
                            }
                        }
                    }
                }
            }
            _ => {}
        }
        resolution.done.insert((file, node));
    }

    /// `checkTypeParameterDeferred`, of the type parameters `params` of a declaration of the class, interface or type alias `symbol`:
    /// 2637, 2636.
    pub(super) fn check_type_parameters_deferred(
        &mut self,
        file: FileId,
        symbol: crate::bind::SymbolId,
        params: Span<TypeParamId>,
        is_alias: bool,
    ) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let is_annotated = |tp: TypeParamId| hir[tp].flags.intersects(Flags::IN | Flags::OUT);
        // Where the only declaration annotates nothing, nothing is annotated.
        if symbol.is_none()
            || !params.iter().any(is_annotated)
                && bound.symbols[symbol.idx()].decls.len() == 1
                && !bound.symbols[symbol.idx()].flags.contains(SymFlags::MERGED)
        {
            return;
        }
        let sym = self.files().sym(file, symbol);
        let declared = self.declared_type(sym);
        // A reference to a class or an interface takes the outer type parameters first.
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
                // A name that is missing takes no room, and is where the token before it ends.
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
            // `c.varianceTypeParameter`: the markers go by its name for as long as this is put into words.
            self.set_variance_type_parameter(Some(own));
            let at = (file, start, self.end_of_type_param(file, tp));
            self.check_type_assignable_to(source, target, Some(at), Some(2636));
            self.set_variance_type_parameter(None);
            self.reliability = reliability;
        }
    }

    // ───────────────────────────── signatures ─────────────────────────────

    /// Whether `f` is a member of a class or of an object literal, as opposed to one of an interface or a type literal.
    fn is_member_with_room_for_a_body(&self, file: FileId, f: FnId) -> bool {
        let bound = self.bound(file);
        match bound.fns[f.idx()].owner {
            FnOwner::Member(m) => matches!(bound.member_owner[m.idx()], MemberOwner::Class(_)),
            FnOwner::Expr(_) => true,
            _ => false,
        }
    }

    // ───────────────────────────── what is returned ─────────────────────────────

    /// `checkTypePredicate`: 1228, 1229, 2677, 1230, 1225.
    pub(super) fn check_type_predicate(&mut self, file: FileId, node: TypeNodeId) {
        let hir = self.hir(file);
        let TypeNodeKind::Predicate { param, ty, asserts } = hir[node].kind else {
            return;
        };
        let text = &hir.text[..];
        // `getTypePredicateParent`
        let parent = hir
            .function_of(hir.parent(hir.node(node)))
            .some()
            .filter(|&f| {
                hir[f].ret == node
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
        let start = start_of_written_type(text, hir[ty].pos);
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
            || func.kind == FnKind::Method && self.is_member_with_room_for_a_body(file, f);
        if is_declaration && has_body(func) && self.type_from_node(file, func.ret) == TypeId::VOID {
            let start = start_of_written_type(&hir.text, hir[func.ret].pos);
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
                || func.kind == FnKind::Method && self.is_member_with_room_for_a_body(file, f))
        {
            return;
        }
        let ret = self.type_from_node(file, func.ret);
        if self.is_error_type(ret) {
            return;
        }
        if self.global_type_symbol(known::Promise).is_some()
            && self.is_global_ref(ret, known::Promise).is_none()
        {
            let start = start_of_written_type(&hir.text, hir[func.ret].pos);
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

    /// `createPromiseReturnType`, where there is a `Promise` to name as a type but none to make one with: 2712, 2705.
    fn check_promise_constructor_is_there(&mut self, file: FileId) {
        if self.global_type_symbol(known::Promise).is_none()
            || self
                .files()
                .global(known::Promise, SymFlags::VALUE)
                .is_some()
        {
            return;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        let by_kind = self.exprs_by_kind(file);
        for &id in by_kind.of(ExprTag::ImportCall) {
            let e = &hir[id];
            if !bound.is_unchecked(id.idx()) && word_at(&hir.text, e.pos as usize) == b"import" {
                let end = self.end_inside_parentheses(file, id);
                self.error_at((file, e.pos, end), 2712, &[]);
                // `getGlobalPromiseConstructorSymbol`
                self.report_global_error(2468, vec![b"Promise".to_vec()]);
            }
        }
        // `getReturnTypeFromBody` only gets there for a function that returns nothing, calls of itself aside.
        for i in 0..hir.fns.len() {
            let (f, func) = (FnId(i as u32), &hir.fns[i]);
            let info = &bound.fns[i];
            if !func.flags.contains(Flags::ASYNC)
                || func.flags.contains(Flags::GENERATOR)
                || func.ret.is_some()
                || !matches!(func.body, FnBody::Block(_))
                || bound.ids(info.returns).any(|s| match hir[s].kind {
                    StmtKind::Return(e) if e.is_some() => match hir[e].kind {
                        ExprKind::Await(operand) => !is_call_of_itself(hir, bound, f, operand),
                        _ => !is_call_of_itself(hir, bound, f, e),
                    },
                    _ => false,
                })
            {
                continue;
            }
            // What it returns has to be asked for: it always is of an expression, by a `return`, and by a call.
            let is_asked = match (func.kind, info.owner) {
                (FnKind::Expr | FnKind::Arrow | FnKind::Method, FnOwner::Expr(_)) => true,
                (FnKind::Decl | FnKind::Method, FnOwner::Stmt(_) | FnOwner::Member(_))
                    if !info.returns.is_empty() =>
                {
                    true
                }
                (FnKind::Decl, FnOwner::Stmt(_)) => {
                    let symbol = bound.fn_symbol[i];
                    symbol.is_some()
                        && bound.symbols[symbol.idx()].decls.len() == 1
                        && hir.exprs.iter().any(|e| {
                            matches!(e.kind, ExprKind::Call(call) if matches!(hir[hir[call].callee].kind, ExprKind::Ident(_)) && bound.expr_symbol[hir[call].callee.idx()] == symbol)
                        })
                }
                _ => false,
            };
            if is_asked {
                let (start, end) = self.error_range_of_fn(file, f);
                self.error_at((file, start, end), 2705, &[]);
                self.report_global_error(2468, vec![b"Promise".to_vec()]);
            }
        }
    }
}

/// Whether `e` calls the function `f` by its own name, which says nothing about what `f` returns.
fn is_call_of_itself(hir: &hir::File, bound: &Bound, f: FnId, e: ExprId) -> bool {
    let symbol = bound.fn_symbol[f.idx()];
    symbol.is_some()
        && matches!(hir[e].kind, ExprKind::Call(call) if matches!(hir[hir[call].callee].kind, ExprKind::Ident(_)) && bound.expr_symbol[hir[call].callee.idx()] == symbol)
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum DefaultState {
    Resolving,
    Resolved,
    Circular,
}

/// How far `getResolvedTypeParameterDefault` has got with each type parameter it was asked about, and the types written whose
/// working out is over and done with.
#[derive(Default)]
struct DefaultResolution {
    states: FxHashMap<(FileId, TypeParamId), DefaultState>,
    done: FxHashSet<(FileId, TypeNodeId)>,
}

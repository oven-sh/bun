//! `isTypeParameterPossiblyReferenced`, for the names that it resolves.
//!
//! In TypeScript 7.0.2's checker.go `getObjectTypeInstantiation` asks it of every type parameter in scope the first time
//! an anonymous type is instantiated, and `getTypeFromConditionalTypeNode` when it creates a conditional type. Its
//! `containsReference` walks the syntax of the type until it finds a reference to the type parameter. On the way it
//! resolves each type reference without type arguments (`getSymbolFromTypeReference`) and the first identifier of each
//! type query (`getResolvedSymbol`): a name that does not resolve is reported, and one that does is used.
//!
//! `Mentioned` in decl.rs answers the question from the syntax alone, when the type is created. `checkSourceFile`
//! resolves every name of a file itself, but for those below the type arguments of an import type
//! (`File::type_arguments_of_import_types`). So this module resolves those, where checker.go does.

use super::*;
use crate::bind::{Decl, FnOwner, MemberOwner, ScopeId, SymbolId};
use smallvec::SmallVec;

/// `tp` of `isTypeParameterPossiblyReferenced`: a type parameter that has one declaration, in the file of the syntax.
#[derive(Copy, Clone)]
struct OuterTypeParameter {
    /// `tp.symbol`
    symbol: Sym,
    /// Its name. `known::this` for a `this` type.
    name: Atom,
    /// `tp.symbol.Declarations[0]`
    declaration: Node,
    /// `tp.isThisType`
    is_this_type: bool,
}

impl Checker<'_, '_> {
    /// `getObjectTypeInstantiation` of `ty` with `mapper`, where it finds no `links.outerTypeParameters`: "The first time
    /// an anonymous type is instantiated we compute and store a list of the type parameters that are in scope (and
    /// therefore potentially referenced)." `ty` has `ObjectFlags::RESOLVES_NAMES_AT_INSTANTIATION`.
    #[cold]
    #[inline(never)]
    pub(super) fn resolve_names_at_first_instantiation(&mut self, ty: TypeId, mapper: MapperId) {
        // A declared type has no mapper in tsgo. Here it has one of identity pairs.
        if (self.types().mapping(mapper).iter()).all(|pair| pair.0 == pair.1) {
            return;
        }
        // `t.symbol.Declarations`, or the node of a deferred type reference or of an instantiation expression.
        let mut declarations: SmallVec<[(FileId, Node); 2]> = SmallVec::new();
        if let Some(deferred) = self.types().deferred(ty) {
            declarations.push((deferred.file, self.hir(deferred.file).node(deferred.node)));
        } else {
            match self.data(ty) {
                &TypeData::Anon {
                    origin: Origin::TypeLiteral(file, node) | Origin::Mapped(file, node),
                    ..
                } => declarations.push((file, self.hir(file).node(node))),
                TypeData::Fns { decls, .. } => match self.declarations_of_fns(decls) {
                    Some(of_symbol) => declarations = of_symbol,
                    None => return,
                },
                TypeData::Synth(shape) => match shape.instantiation_expression {
                    Some(InstantiationExpression::TypeNode(file, node)) => {
                        declarations.push((file, self.hir(file).node(node)));
                    }
                    Some(InstantiationExpression::Expr(file, e)) => {
                        declarations.push((file, self.hir(file).node(e)));
                    }
                    None => return,
                },
                _ => return,
            }
        }
        let Some(&(file, first)) = declarations.first() else {
            return;
        };
        if !self.names_resolved_at_instantiation.insert((file, first)) {
            return;
        }
        let hir = self.hir(file);
        let (scope, type_node) = match hir.data(first) {
            NodeData::Type(node) => (self.bound(file).type_scope[node.idx()], Some(node)),
            NodeData::Expr(e) if hir.function_of(first).is_none() => {
                (self.enclosing_scope_of_expr(file, e), None)
            }
            _ => {
                let func = hir.function_of(first);
                if func.is_none() {
                    return;
                }
                let scope = self.bound(file).fns[func.idx()].scope;
                (self.bound(file).scopes[scope.idx()].parent, None)
            }
        };
        // `len(target.alias.TypeArguments()) == 0`
        if type_node.is_some_and(|node| self.is_body_of_generic_alias(file, scope, node)) {
            return;
        }
        for tp in self.outer_type_parameters_with_one_declaration(file, scope, type_node) {
            // `core.Some(t.symbol.Declarations, ..)`
            for &(of, declaration) in &declarations {
                if of != file
                    || self.is_type_parameter_possibly_referenced_in(file, &tp, declaration)
                {
                    break;
                }
            }
        }
    }

    /// `instantiateType(ty, m)` where tsgo has a mapper `m` that can map every type parameter to itself: the type
    /// arguments of a signature or of a type reference can be the declaration's own type parameters. `instantiate`
    /// takes such a mapper for none, and `getObjectTypeInstantiation` resolves names the first time whatever the
    /// mapper maps: see `resolve_names_at_first_instantiation`.
    #[inline]
    pub(super) fn resolve_names_under_own_type_parameters(&mut self, ty: TypeId) {
        let resolves_names = ObjectFlags::RESOLVES_NAMES_AT_INSTANTIATION;
        if self.types().object_flags(ty).contains(resolves_names) {
            // Only type parameters are looked up in a mapper, so the pair maps nothing.
            let mapper = self.types().mapper_of(&[(TypeId::NEVER, TypeId::UNKNOWN)]);
            self.instantiate(ty, mapper);
        }
    }

    /// True if a signature of `func` that has `mapper` is an instantiation: `getSignatureInstantiation` has given it
    /// type arguments for the type parameters of `func`, or of its class if it is a constructor.
    pub(super) fn has_type_arguments_of_signature(
        &self,
        file: FileId,
        func: FnId,
        mapper: MapperId,
    ) -> bool {
        if mapper == MapperId::IDENTITY {
            return false;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        let of_class = match (hir[func].kind, bound.fns[func.idx()].owner) {
            (FnKind::Constructor, FnOwner::Member(m)) => match bound.member_owner[m.idx()] {
                MemberOwner::Class(class) => hir[class].type_params,
                _ => Span::default(),
            },
            _ => Span::default(),
        };
        let own = hir[func].type_params;
        (self.types().mapping(mapper).iter()).any(|pair| {
            self.is_declared_among(pair.0, file, own)
                || self.is_declared_among(pair.0, file, of_class)
        })
    }

    /// `t.symbol.Declarations` for the type of the function-likes `decls`, if `getObjectTypeInstantiation` filters the
    /// type parameters in scope by what those declarations reference: the symbol is a method, or the `__type` of a
    /// function type or a constructor type. `None` for a function, where every type parameter in scope stays.
    pub(super) fn declarations_of_fns(
        &self,
        decls: &[(FileId, FnId)],
    ) -> Option<SmallVec<[(FileId, Node); 2]>> {
        let mut declarations: SmallVec<[(FileId, Node); 2]> = SmallVec::new();
        for &(file, func) in decls {
            let (hir, bound) = (self.hir(file), self.bound(file));
            let is_filtered = matches!(
                hir.kind(hir.node(func)),
                Kind::FunctionType
                    | Kind::ConstructorType
                    | Kind::MethodDeclaration
                    | Kind::MethodSignature
            );
            if !is_filtered {
                return None;
            }
            let symbol = match bound.fns[func.idx()].owner {
                FnOwner::Member(m) => bound.member_symbol[m.idx()],
                _ => SymbolId::NONE,
            };
            if symbol.is_none() {
                declarations.push((file, hir.node(func)));
                continue;
            }
            // `decls` has no implementation of overloads, which is a declaration of the symbol too.
            for &declaration in bound.symbol(symbol).decls {
                if let Decl::Member(m) = declaration
                    && hir[m].kind == MemberKind::Method
                    && hir[m].func.is_some()
                    && !declarations.contains(&(file, hir.node(hir[m].func)))
                {
                    declarations.push((file, hir.node(hir[m].func)));
                }
            }
        }
        Some(declarations)
    }

    /// `FirstRequest::RESOLVES_NAMES_AT_INSTANTIATION` for the type of the function-likes `decls`: see
    /// `first_request_of_anonymous_type`. It depends on nothing else, so every request for that type gives the same.
    pub(super) fn first_request_of_fns(&mut self, decls: &[(FileId, FnId)]) -> FirstRequest {
        // FOR SPEED: most files have no import type with type arguments.
        let mut files = decls.iter().map(|&(file, _)| self.hir(file));
        if files.all(|hir| hir.type_arguments_of_import_types().is_empty()) {
            return FirstRequest::NONE;
        }
        let Some(declarations) = self.declarations_of_fns(decls) else {
            return FirstRequest::NONE;
        };
        let mut first_request = FirstRequest::NONE;
        for (file, declaration) in declarations {
            let (hir, bound) = (self.hir(file), self.bound(file));
            let func = hir.function_of(declaration);
            if func.is_none() {
                continue;
            }
            let scope = bound.scopes[bound.fns[func.idx()].scope.idx()].parent;
            let function = &hir[func];
            // The types that JSDoc tags give a signature are in a comment before it.
            let in_comments = (function.params.iter().map(|p| hir[p].ty))
                .chain([function.ret, function.this_ty(hir)])
                .chain([hir.jsdoc_type(JsDocTypeOwner::Fn(func))])
                .filter(|node| node.is_some())
                .map(|node| (hir[node].pos, hir[node].end));
            let type_parameters = function.type_params.iter().map(|tp| {
                let node = hir.node(tp);
                (hir.start(node), self.end_of_node(file, node))
            });
            let own = (hir.start(declaration), self.end_of_node(file, declaration));
            let ranges: SmallVec<[(u32, u32); 8]> = std::iter::once(own)
                .chain(in_comments)
                .chain(type_parameters)
                .collect();
            for range in ranges {
                let of_range = self.first_request_of_anonymous_type(file, scope, range);
                first_request = first_request.with(of_range);
            }
        }
        first_request
    }

    /// The type of the function-likes `decls`, the signatures of one symbol, with `mapper` for the type parameters in
    /// scope.
    pub(super) fn fns_type(&mut self, decls: &[(FileId, FnId)], mapper: MapperId) -> TypeId {
        let first_request = self.first_request_of_fns(decls);
        self.intern_key_as(TypeKey::Fns { decls, mapper }, first_request)
    }

    /// `instantiateType(baseType, mapper)` of `resolveObjectTypeMembers`, for a reference to `target` whose members are
    /// resolved. The members here are those of the declared type, under `mapper`: nothing else instantiates a base type
    /// that references no type parameter.
    #[cold]
    #[inline(never)]
    pub(super) fn instantiate_base_types_that_resolve_names(
        &mut self,
        target: Sym,
        mapper: MapperId,
    ) {
        let Some(base_types) = self.p.base_types.get_ref(&self.task, &target) else {
            return;
        };
        let resolves_names = ObjectFlags::RESOLVES_NAMES_AT_INSTANTIATION;
        for &base_type in base_types.iter() {
            if self
                .types()
                .object_flags(base_type)
                .contains(resolves_names)
            {
                self.instantiate(base_type, mapper);
            }
        }
    }

    /// `getTypeFromConditionalTypeNode` for the conditional type `node`, which is in `scope`: it asks
    /// `isTypeParameterPossiblyReferenced` of every type parameter in scope, unless `node` is the body of a generic alias.
    pub(super) fn resolve_names_of_conditional_type(
        &mut self,
        file: FileId,
        scope: ScopeId,
        node: TypeNodeId,
    ) {
        let hir = self.hir(file);
        if hir.type_arguments_of_import_types().is_empty()
            || !self.reports_semantic_errors(file)
            || self.is_body_of_generic_alias(file, scope, node)
        {
            return;
        }
        for tp in self.outer_type_parameters_with_one_declaration(file, scope, Some(node)) {
            self.is_type_parameter_possibly_referenced_in(file, &tp, hir.node(node));
        }
    }

    /// `getOuterTypeParameters(node, true /*includeThisTypes*/)` for syntax in `scope`, without those for which
    /// `isTypeParameterPossiblyReferenced` holds whatever the syntax is: one with no symbol or with several declarations.
    /// `type_node`: the syntax, if it is a type node.
    fn outer_type_parameters_with_one_declaration(
        &mut self,
        file: FileId,
        scope: ScopeId,
        type_node: Option<TypeNodeId>,
    ) -> SmallVec<[OuterTypeParameter; 4]> {
        let mut in_scope: SmallVec<[TypeId; 8]> =
            SmallVec::from_slice(self.type_params_in_scope(file, scope));
        if let Some(node) = type_node {
            in_scope.extend(self.infer_type_parameters_around(file, node));
        }
        let hir = self.hir(file);
        let mut type_parameters = SmallVec::new();
        for tp in in_scope {
            match *self.data(tp) {
                TypeData::TypeParam(of, declaration, _) if of == file => {
                    let symbol = self.bound(of).type_param_symbol[declaration.idx()];
                    if symbol.is_some() && self.type_param_has_one_declaration(of, declaration) {
                        type_parameters.push(OuterTypeParameter {
                            symbol: self.files().sym(of, symbol),
                            name: hir[declaration].name,
                            declaration: hir.node(declaration),
                            is_this_type: false,
                        });
                    }
                }
                TypeData::ThisParam(owner) => {
                    let declarations = self.files().decls_of(owner);
                    let mut declarations = declarations.iter();
                    // `getOuterTypeParameters` lists no `this` type for an interface that has none.
                    if let (Some(&(of, declaration)), None) =
                        (declarations.next(), declarations.next())
                        && of == file
                        && self.has_this_type(owner)
                    {
                        type_parameters.push(OuterTypeParameter {
                            symbol: owner,
                            name: known::this,
                            declaration: hir.node(declaration),
                            is_this_type: true,
                        });
                    }
                }
                _ => {}
            }
        }
        type_parameters
    }

    /// `isTypeParameterPossiblyReferenced(tp, node)`, for `node` of `file`.
    fn is_type_parameter_possibly_referenced_in(
        &mut self,
        file: FileId,
        tp: &OuterTypeParameter,
        node: Node,
    ) -> bool {
        let hir = self.hir(file);
        let container = hir.parent(tp.declaration);
        let mut n = node;
        while n != container {
            if n.is_none() {
                return true;
            }
            match hir.kind(n) {
                Kind::Block => return true,
                Kind::ConditionalType => {
                    if let NodeData::Type(conditional) = hir.data(n)
                        && let TypeNodeKind::Cond { extends, .. } = hir[conditional].kind
                        && self.contains_reference(file, tp, hir.node(extends))
                    {
                        return true;
                    }
                }
                _ => {}
            }
            n = hir.parent(n);
        }
        self.contains_reference(file, tp, node)
    }

    /// `containsReference` of `isTypeParameterPossiblyReferenced`
    fn contains_reference(&mut self, file: FileId, tp: &OuterTypeParameter, node: Node) -> bool {
        if node.is_none() {
            return false;
        }
        let hir = self.hir(file);
        match hir.kind(node) {
            Kind::ThisType => return tp.is_this_type,
            Kind::TypeReference => {
                if !tp.is_this_type
                    && let NodeData::Type(reference) = hir.data(node)
                    && let TypeNodeKind::Ref { name, args } = hir[reference].kind
                    && args.is_empty()
                    && self.is_type_reference_to(file, reference, name, tp)
                {
                    return true;
                }
            }
            Kind::TypeQuery => {
                let NodeData::Type(query) = hir.data(node) else {
                    return true;
                };
                let TypeNodeKind::Typeof { expr, args, .. } = hir[query].kind else {
                    return true;
                };
                let first_identifier = first_identifier(hir, expr);
                // `typeof this.a`
                let ExprKind::Ident(name) = hir[first_identifier].kind else {
                    return true;
                };
                let symbol =
                    self.resolved_symbol_of_type_query(file, query, first_identifier, name);
                let tp_scope = match tp.is_this_type {
                    true => tp.declaration,
                    false => hir.parent(tp.declaration),
                };
                let declarations = symbol.map(|symbol| self.files().decls_of(symbol));
                let is_declared_in_scope = declarations.is_some_and(|declarations| {
                    declarations.iter().any(|&(of, declaration)| {
                        of == file
                            && (hir.find_ancestor(hir.node(declaration), |n| n == tp_scope))
                                .is_some()
                    })
                });
                return is_declared_in_scope
                    || (hir.ids(args))
                        .any(|argument| self.contains_reference(file, tp, hir.node(argument)));
            }
            Kind::MethodDeclaration | Kind::MethodSignature => {
                let func = hir.function_of(node);
                if func.is_some() {
                    let function = &hir[func];
                    let has_return_type = function.ret.is_some();
                    return !has_return_type && !matches!(function.body, FnBody::None)
                        || (function.type_params.iter())
                            .any(|p| self.contains_reference(file, tp, hir.node(p)))
                        // `node.Parameters()` begins with the `this` parameter.
                        || function.this_param.is_some()
                            && self.contains_reference(file, tp, hir.node(function.this_param))
                        || (function.params.iter())
                            .any(|p| self.contains_reference(file, tp, hir.node(p)))
                        || has_return_type
                            && self.contains_reference(file, tp, hir.node(function.ret));
                }
            }
            _ => {}
        }
        hir.for_each_child(node, &mut |child| self.contains_reference(file, tp, child))
    }

    /// `getSymbolFromTypeReference(node) == tp.symbol` for the type reference `node`, which has the `name` and no type
    /// arguments. `checkSourceFile` resolves the name itself, unless no check visits `node`.
    fn is_type_reference_to(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        name: Span<NameId>,
        tp: &OuterTypeParameter,
    ) -> bool {
        let hir = self.hir(file);
        let scope = self.bound(file).type_scope[node.idx()];
        // `links.resolvedSymbol`: with the type of the node its name is resolved.
        let is_resolved = self
            .p
            .type_node_types
            .get(&self.task, &(file, node))
            .is_some()
            || self.stack.contains(&Query::TypeNode(file, node));
        // `resolveTypeReferenceName(node, SymbolFlagsType, false /*ignoreErrors*/)`: it references what it finds, and
        // whatever reports that the name does not resolve belongs to the node.
        if !is_resolved
            && (hir.type_arguments_of_import_types()).contain(hir[node].pos)
            && (self.resolve_type_reference_name(file, scope, name, true)).is_none()
        {
            self.type_from_node(file, node);
            return false;
        }
        let mut names = hir.texts(name);
        names.next() == Some(tp.name)
            && names.next().is_none()
            && self
                .files()
                .resolve_name(file, scope, tp.name, SymFlags::TYPE)
                == Some(tp.symbol)
    }

    /// `getResolvedSymbol(firstIdentifier)` for the type query `node`, whose first identifier is `e`, the `name`.
    fn resolved_symbol_of_type_query(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        e: ExprId,
        name: Atom,
    ) -> Option<Sym> {
        let hir = self.hir(file);
        let symbol = self.symbol_of_identifier(file, e, name);
        // `checkIdentifier` of an identifier that does not resolve reports that, and no more.
        if symbol.is_none() && (hir.type_arguments_of_import_types()).contain(hir[node].pos) {
            self.type_of_expr(file, e);
        }
        symbol
    }
}

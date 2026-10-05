//! How the node builder serializes a declared type when it has an enclosing declaration. The type
//! is derived from the syntax (`pseudochecker`), compared with the checker's type
//! (`pseudoTypeEquivalentToType`) and, if the two agree, printed as in the source
//! (`pseudotypenodebuilder.go`, `nodecopy.go`). The same pseudochecker is used to check
//! `isolatedDeclarations`.

use super::super::errors_declaration_emit::{Element, ListFormat, Writer, comments_text};
use super::super::errors_isolated_declarations::{
    Emit, EquivalenceOptions, Pseudo, PseudoElement, PseudoElementKind, PseudoParam,
};
use super::*;

// ───────────────────────────── declarations (`nodebuilderimpl.go`) ─────────────────────────────

/// The options of `Printer::serialize_type_for_declaration`.
#[derive(Copy, Clone)]
pub(super) struct SerializeTypeOptions {
    /// `tryReuse`
    pub(super) try_reuse: bool,
    /// If the type is that of an array literal, it still has `ObjectFlagsArrayLiteral`, a flag that
    /// types do not store.
    pub(super) is_unwidened: bool,
    /// The symbol is an optional property of a reverse mapped type.
    pub(super) is_optional_reverse_mapped: bool,
}

impl<'p> Printer<'_, 'p, '_> {
    /// `b.ctx.enclosingDeclaration != nil`: whether the type of a declaration is derived from its
    /// syntax.
    fn reuses_nodes(&self) -> bool {
        self.enclosing_declaration.is_some()
    }

    /// `symbolToParameterDeclaration`: the type of `parameter`.
    pub(super) fn serialize_type_of_parameter(&mut self, parameter: &Parameter) -> Node {
        match parameter.declaration {
            Some((file, declaration)) if self.reuses_nodes() => self
                .serialize_type_for_declaration(
                    file,
                    self.c.hir(file).node(declaration),
                    parameter.ty,
                    SerializeTypeOptions {
                        try_reuse: true,
                        is_unwidened: false,
                        is_optional_reverse_mapped: false,
                    },
                ),
            _ => self.type_to_node(parameter.ty),
        }
    }

    /// `tryGetThisParameterDeclaration`: the type `this` of a `this` parameter that `declared_by` declares.
    pub(super) fn serialize_type_of_this_parameter(
        &mut self,
        declared_by: SigId,
        this: TypeId,
    ) -> Node {
        if let Some((file, func, _)) = self.c.sig_decl(declared_by)
            && self.reuses_nodes()
        {
            let written = self.c.hir(file)[func].this_ty(self.c.hir(file));
            if written.is_some() && self.c.type_from_node(file, written) == this {
                return self.reuse_type_node(file, written);
            }
        }
        self.type_to_node(this)
    }

    /// `addPropertyToElementList`: the type `ty` of the property `prop` of `owner`.
    pub(super) fn serialize_type_of_property(
        &mut self,
        owner: TypeId,
        prop: &Prop,
        ty: TypeId,
    ) -> Node {
        if self.reuses_nodes()
            && let Some((file, declaration)) = self.value_declaration_of_property(prop)
        {
            // The properties of an unwidened object literal are unwidened too.
            let is_unwidened = matches!(
                self.c.data(owner),
                TypeData::Anon {
                    origin: Origin::ObjectLiteral(..),
                    ..
                }
            );
            // `t.symbol == symbol`: a symbol derived from the declared one (`getSpreadSymbol`,
            // `createSymbolWithType`) is not the symbol of its `unique symbol` type.
            if !matches!(prop.source, PropSource::Symbol(_))
                && matches!(self.c.data(ty), TypeData::UniqueSymbol { .. })
            {
                return self.serialize_type_for_declaration_worker(
                    file,
                    declaration,
                    ty,
                    is_unwidened,
                    false,
                );
            }
            // `symbol.Flags&SymbolFlagsOptional != 0 && ReverseMappedSymbolLinks.Has(symbol)`
            let is_optional_reverse_mapped = prop.flags.contains(PropFlags::OPTIONAL)
                && matches!(self.c.data(owner), TypeData::ReverseMapped { .. });
            return self.serialize_type_for_declaration(
                file,
                declaration,
                ty,
                SerializeTypeOptions {
                    try_reuse: true,
                    is_unwidened,
                    is_optional_reverse_mapped,
                },
            );
        }
        self.type_to_node(ty)
    }

    /// `addPropertyToElementList`: the return type of the getter of `prop` or the parameter type of
    /// its setter, selected by `kind`. That type is `ty`.
    pub(super) fn serialize_type_of_accessor(
        &mut self,
        prop: &Prop,
        kind: MemberKind,
        ty: TypeId,
    ) -> Node {
        // `GetDeclarationOfKind`
        let declaration = match prop.source {
            PropSource::Symbol(symbol) => (self.c.members_of_symbol(symbol).iter())
                .find(|&&(file, member)| self.c.hir(file)[member].kind == kind)
                .map(|&(file, member)| (file, self.c.hir(file).node(member))),
            PropSource::Literal(file, p) => {
                let kind = match kind {
                    MemberKind::Getter => PropKind::Getter,
                    _ => PropKind::Setter,
                };
                self.c
                    .bound(file)
                    .declarations_of_literal_member(p)
                    .into_iter()
                    .find(|&declaration| self.c.hir(file)[declaration].kind == kind)
                    .map(|declaration| (file, self.c.hir(file).node(declaration)))
            }
            _ => None,
        };
        if self.reuses_nodes()
            && let Some((file, declaration)) = declaration
        {
            return self.serialize_type_for_declaration(
                file,
                declaration,
                ty,
                SerializeTypeOptions {
                    try_reuse: true,
                    is_unwidened: false,
                    is_optional_reverse_mapped: false,
                },
            );
        }
        self.type_to_node(ty)
    }

    /// The syntax-based part of `serializeReturnTypeForSignature`. `returned`: `returnType`.
    /// `None`: the checker's type is used.
    pub(super) fn try_reuse_return_type_of_signature(
        &mut self,
        signature: SigId,
        returned: TypeId,
    ) -> Option<Node> {
        let (file, func, _) = self.c.sig_decl(signature)?;
        if !self.reuses_nodes() {
            return None;
        }
        let pt = self.c.iso_pseudo_of_return(file, func);
        // `getReturnTypeOfSignature`: a circular annotation resolves to `anyType`, which is not the
        // annotated type.
        let (p, key) = (self.c.p, (file, func));
        if matches!(pt, Pseudo::Direct(_))
            && ((p.fn_return_types.get(&self.c.task, &key))
                .is_some_and(|(_, is_circular)| is_circular)
                || p.circular_returns.get(&self.c.task, &key).is_some())
        {
            return None;
        }
        let report_errors = !self.suppress_report_inference_fallback;
        if !self.pseudo_type_equivalent_to_type(file, &pt, returned, false, report_errors) {
            return None;
        }
        // The pseudochecker does not see an inferred type predicate.
        if let Some(predicate) = self.c.sig_predicate(signature)
            && !self
                .c
                .iso_matches_predicate(file, &pt, signature, predicate)
        {
            if !self.suppress_report_inference_fallback {
                let declaration = self.c.hir(file).node(func);
                self.report_inference_fallback(file, declaration);
            }
            return None;
        }
        Some(self.pseudo_type_to_node_with_checker_fallback(file, &pt, returned))
    }

    /// `addPropertyToElementList`: the `enclosingDeclaration` used to build the name of `prop`,
    /// which is `value_declaration_of_property`.
    pub(super) fn enclosing_declaration_of_property_name(
        &mut self,
        prop: &Prop,
    ) -> Option<Enclosing> {
        let (file, declaration) = self.value_declaration_of_property(prop)?;
        let scope = match self.c.hir(file).data(declaration) {
            NodeData::Member(member) => self.c.enclosing_scope_of_member(file, member),
            NodeData::Prop(written) => self.c.enclosing_scope_of_property(file, written),
            NodeData::Param(parameter) => {
                let pat = self.c.hir(file)[parameter].pat;
                self.c.enclosing_scope_of_pat(file, pat)
            }
            NodeData::Expr(assignment) => self.c.enclosing_scope_of_expr(file, assignment),
            _ => return None,
        };
        Some(Enclosing::at_scope(file, scope))
    }

    /// `symbol.ValueDeclaration`, or else the first of `symbol.Declarations`.
    pub(super) fn value_declaration_of_property(
        &mut self,
        prop: &Prop,
    ) -> Option<(FileId, hir::Node)> {
        if matches!(prop.source, PropSource::Intersected(..)) {
            return None;
        }
        match &first_declared(prop)?.source {
            PropSource::Symbol(symbol) => match self.c.files().value_declaration(*symbol)? {
                (file, Decl::Member(member)) => Some((file, self.c.hir(file).node(member))),
                (file, Decl::ParameterProperty(parameter)) => {
                    Some((file, self.c.hir(file).node(parameter)))
                }
                // An export of a module or a namespace.
                (file, variable @ Decl::Var(_)) => Some((file, self.c.hir(file).node(variable))),
                // Among assignment declarations, the first annotated one determines the type.
                (file, Decl::Expando(first) | Decl::ThisProperty(first)) => {
                    let (hir, list) = (self.c.hir(file), self.c.assignments_of_symbol(*symbol));
                    let annotated = list
                        .iter()
                        .find(|&&e| hir.jsdoc_type(JsDocTypeOwner::Assign(e)).is_some());
                    Some((file, self.c.hir(file).node(*annotated.unwrap_or(&first))))
                }
                _ => None,
            },
            PropSource::Literal(file, written) => {
                // A JSX attribute has no inferred type.
                let owner = self.c.bound(*file).prop_owner[written.idx()];
                let is_in_object_literal =
                    owner.is_some() && matches!(self.c.hir(*file)[owner].kind, ExprKind::Object(_));
                // `prop.ValueDeclaration = member.ValueDeclaration`: the first declaration of the name.
                let declarations = self.c.bound(*file).declarations_of_literal_member(*written);
                let first = declarations.first().copied().unwrap_or(*written);
                is_in_object_literal.then_some((*file, self.c.hir(*file).node(first)))
            }
            _ => None,
        }
    }

    /// `containsNonMissingUndefinedType`
    fn contains_non_missing_undefined_type(&self, ty: TypeId) -> bool {
        self.c
            .parts(ty)
            .iter()
            .any(|member| member.is_undefined() && *member != TypeId::MISSING)
    }

    /// `serializeTypeForDeclaration` for the declaration `node` of `file`, whose type is `ty` here.
    pub(super) fn serialize_type_for_declaration(
        &mut self,
        file: FileId,
        node: hir::Node,
        ty: TypeId,
        options: SerializeTypeOptions,
    ) -> Node {
        let SerializeTypeOptions {
            try_reuse,
            is_unwidened,
            is_optional_reverse_mapped,
        } = options;
        let hir = self.c.hir(file);
        // `requiresAddingImplicitUndefined`
        let requires_undefined = match hir.data(node) {
            NodeData::Param(p) => {
                let enclosing_declaration = self.enclosing_declaration;
                self.c
                    .requires_adding_implicit_undefined(file, p, enclosing_declaration)
            }
            NodeData::Member(m) => {
                is_optional_reverse_mapped
                    && hir[m].kind == MemberKind::Property
                    && hir[m].flags.contains(Flags::OPTIONAL)
                    && self.contains_non_missing_undefined_type(ty)
            }
            _ => false,
        };
        // `addUndefinedForParameter`
        let ty = if requires_undefined && hir.kind(node) == Kind::Parameter {
            self.c.optional(ty)
        } else {
            ty
        };
        let saved_flags = self.flags;
        if self.is_unique_symbol_of_declaration(file, node, ty) {
            self.flags |= ALLOW_UNIQUE_ES_SYMBOL_TYPE;
        }
        let result = if try_reuse {
            self.serialize_type_for_declaration_worker(
                file,
                node,
                ty,
                is_unwidened,
                requires_undefined,
            )
        } else {
            self.type_to_node(ty)
        };
        self.flags = saved_flags;
        result
    }

    /// `t.flags&TypeFlagsUniqueESSymbol != 0 && t.symbol == symbol`, and the symbol is declared in the enclosing file.
    fn is_unique_symbol_of_declaration(&self, file: FileId, node: hir::Node, ty: TypeId) -> bool {
        let TypeData::UniqueSymbol { symbol, .. } = *self.c.data(ty) else {
            return false;
        };
        let own = match self.c.hir(file).data(node) {
            NodeData::VarDecl(d) => {
                let variable = self.c.bound(file).pat_symbol[self.c.hir(file)[d].pat.idx()];
                if variable.is_none() {
                    return false;
                }
                UniqueSymbolDeclaration::Variable(self.c.files().sym(file, variable))
            }
            NodeData::Member(m) => UniqueSymbolDeclaration::Member(file, m),
            _ => return false,
        };
        own == symbol && self.enclosing_declaration.is_none_or(|at| at.file == file)
    }

    /// The rest of `serializeTypeForDeclaration`, under `tryReuse`.
    fn serialize_type_for_declaration_worker(
        &mut self,
        file: FileId,
        node: hir::Node,
        ty: TypeId,
        is_unwidened: bool,
        requires_undefined: bool,
    ) -> Node {
        let hir = self.c.hir(file);
        let accessor = hir
            .function_of(node)
            .some()
            .filter(|&f| matches!(hir[f].kind, FnKind::Getter | FnKind::Setter));
        let requires_widening = self.c.requires_widening(ty);
        if accessor.is_none() && (requires_widening || !self.c.iso_has_inferred_type(file, node)) {
            return self.type_to_node(ty);
        }
        let pt = match accessor {
            Some(func) => self.c.iso_pseudo_of_accessor(file, func),
            None => self.c.iso_pseudo_of_declaration(file, node),
        };
        if is_unwidened && matches!(pt, Pseudo::Tuple(_)) {
            return self.type_to_node(ty);
        }
        // `isOptionalDeclaration`
        let has_question = match hir.data(node) {
            NodeData::Param(p) => hir[p].flags.contains(Flags::OPTIONAL),
            NodeData::Member(m) => {
                hir[m].kind == MemberKind::Property && hir[m].flags.contains(Flags::OPTIONAL)
            }
            _ => false,
        };
        let is_optional_annotated = !requires_undefined && has_question;
        let report_errors = !self.suppress_report_inference_fallback;
        if self.pseudo_type_equivalent_to_type(file, &pt, ty, is_optional_annotated, report_errors)
        {
            let adds_undefined = requires_undefined
                && self.contains_non_missing_undefined_type(ty)
                && match self.c.iso_type_of_pseudo(file, &pt) {
                    Some(from) => !self.contains_non_missing_undefined_type(from),
                    None => false,
                };
            let pt = if adds_undefined {
                Pseudo::Union(vec![pt, Pseudo::Undefined])
            } else {
                pt
            };
            return self.pseudo_type_to_node_with_checker_fallback(file, &pt, ty);
        }
        // An error already reported for an inferred type is not reported again for the types it is
        // composed of.
        let reported_inference_fallback =
            report_errors && matches!(&pt, Pseudo::Inferred { errors, .. } if !errors.is_empty());
        let adds_undefined = requires_undefined
            && match self.c.iso_type_of_pseudo(file, &pt) {
                Some(from) => !self.contains_non_missing_undefined_type(from),
                None => !Checker::iso_could_be_undefined(hir, &pt),
            };
        if adds_undefined {
            let pt = Pseudo::Union(vec![pt, Pseudo::Undefined]);
            if self.pseudo_type_equivalent_to_type(file, &pt, ty, false, report_errors) {
                return self.pseudo_type_to_node_with_checker_fallback(file, &pt, ty);
            }
        }
        if reported_inference_fallback {
            self.type_to_node_without_inference_fallback(ty)
        } else {
            self.type_to_node(ty)
        }
    }

    /// `pseudoTypeEquivalentToType`
    fn pseudo_type_equivalent_to_type(
        &mut self,
        file: FileId,
        pt: &Pseudo,
        ty: TypeId,
        is_optional_annotated: bool,
        report_errors: bool,
    ) -> bool {
        let mut tx = Emit::new(file);
        let options = EquivalenceOptions {
            is_optional_annotated,
            reports: report_errors,
        };
        let is_equivalent = self.c.iso_is_equivalent(&mut tx, pt, ty, options);
        for node in tx.inference_fallbacks {
            self.report_inference_fallback(file, node);
        }
        is_equivalent
    }
}

// ───────────────────────────── types derived from the syntax (`pseudotypenodebuilder.go`)
// ─────────────────────────────

impl<'p> Printer<'_, 'p, '_> {
    /// `pseudoTypeToNodeWithCheckerFallback`
    fn pseudo_type_to_node_with_checker_fallback(
        &mut self,
        file: FileId,
        pt: &Pseudo,
        ty: TypeId,
    ) -> Node {
        match pt {
            Pseudo::Inferred { of, errors, .. } => {
                if !self.suppress_report_inference_fallback {
                    if errors.is_empty() {
                        self.report_inference_fallback(file, *of);
                    }
                    for &node in errors {
                        self.report_inference_fallback(file, node);
                    }
                }
                self.type_to_node_without_inference_fallback(ty)
            }
            Pseudo::Direct(existing)
                if !self.c.can_reuse_existing_js_type_node(file, *existing, ty) =>
            {
                if !self.suppress_report_inference_fallback {
                    self.report_inference_fallback(file, self.c.hir(file).node(*existing));
                }
                self.type_to_node_without_inference_fallback(ty)
            }
            _ => self.pseudo_type_to_node(file, pt),
        }
    }

    /// `pseudoTypeToNode`
    fn pseudo_type_to_node(&mut self, file: FileId, pt: &Pseudo) -> Node {
        let is_strict = self.c.files().options.strict_null_checks;
        match pt {
            Pseudo::Inferred { of, errors, .. } if self.tracker.is_some() => {
                for node in self.c.iso_error_nodes_of_inferred(file, *of, errors) {
                    self.report_inference_fallback(file, node);
                }
            }
            Pseudo::NoResult(node) => self.report_inference_fallback(file, *node),
            _ => {}
        }
        match pt {
            Pseudo::Direct(node) => self.reuse_type_node(file, *node),
            Pseudo::Inferred {
                of,
                is_signature_return: true,
                ..
            } => match self.c.hir(file).function_of(*of).some() {
                Some(func) => self.inferred_return_type_to_node(file, func),
                None => Node::simple(b"any"),
            },
            Pseudo::Inferred { of, .. } => self.inferred_pseudo_type_to_node(file, *of),
            // Only an error type is equivalent to it. The type of the declaration's own symbol is
            // printed.
            Pseudo::NoResult(node) => match self.c.hir(file).function_of(*node).some() {
                Some(func)
                    if !matches!(self.c.hir(file)[func].kind, FnKind::Getter | FnKind::Setter) =>
                {
                    self.inferred_return_type_to_node(file, func)
                }
                _ => self.type_of_declaration_to_node(file, *node, false),
            },
            Pseudo::MaybeConst {
                at,
                constant,
                regular,
            } => {
                if self.c.is_const_context(file, *at) {
                    self.pseudo_type_to_node(file, constant)
                } else {
                    self.pseudo_type_to_node(file, regular)
                }
            }
            Pseudo::Union(members) => {
                let mut parts = Vec::with_capacity(members.len());
                let (mut has_elided_type, mut has_undefined) = (false, false);
                for member in members {
                    if !is_strict && matches!(member, Pseudo::Undefined | Pseudo::Null) {
                        has_elided_type = true;
                        continue;
                    }
                    // `appendTypeNode`: a member that is itself a union is flattened into the
                    // enclosing union.
                    let node = self.pseudo_type_to_node(file, member);
                    let nodes = if node.types.is_empty() {
                        vec![node]
                    } else {
                        let emitted = |text: Vec<u8>| Node::new(text, TYPE_OPERATOR);
                        node.types.into_iter().map(emitted).collect()
                    };
                    for node in nodes {
                        if node.text == b"undefined" {
                            if has_undefined {
                                continue;
                            }
                            has_undefined = true;
                        }
                        parts.push(node);
                    }
                }
                if parts.len() == 1
                    && let Some(only) = parts.pop()
                {
                    return only;
                }
                if parts.is_empty() {
                    return Node::simple(if has_elided_type {
                        &b"any"[..]
                    } else {
                        b"never"
                    });
                }
                Node::union(parts)
            }
            Pseudo::Undefined => Node::simple(if is_strict { &b"undefined"[..] } else { b"any" }),
            Pseudo::Null => Node::simple(if is_strict { &b"null"[..] } else { b"any" }),
            Pseudo::String => Node::simple(b"string"),
            Pseudo::Number => Node::simple(b"number"),
            Pseudo::BigInt => Node::simple(b"bigint"),
            Pseudo::Boolean => Node::simple(b"boolean"),
            Pseudo::False => Node::simple(b"false"),
            Pseudo::True => Node::simple(b"true"),
            Pseudo::Signature {
                func,
                params,
                returns,
            } => {
                let outer_scope = self.enter_scope_of_function(file, *func);
                let head = self.pseudo_signature_head(file, *func, params);
                let returns = self.pseudo_type_to_node(file, returns);
                self.leave_scope(outer_scope);
                Node::function(&cat!(head, b" => "), returns)
            }
            Pseudo::Tuple(elements) => {
                let mut parts = Vec::with_capacity(elements.len());
                for element in elements {
                    parts.push(self.pseudo_type_to_node(file, element).text);
                }
                Node::new(
                    cat!(b"readonly [", parts.join(&b", "[..]), b"]"),
                    TYPE_OPERATOR,
                )
            }
            Pseudo::Object(elements) => self.pseudo_object_literal_to_node(file, elements),
            Pseudo::Literal(e) => {
                let hir = self.c.hir(file);
                match hir[*e].kind {
                    ExprKind::String(value) => {
                        let quote = match hir.text.get(hir[*e].pos as usize) {
                            Some(b'\'') => b'\'',
                            Some(b'`') => b'`',
                            _ => b'"',
                        };
                        Node::simple(quoted(self.c.atoms().bytes(value), quote, false))
                    }
                    ExprKind::Template { exprs } if exprs.is_empty() => {
                        let text = hir.id_at(hir.template_texts(exprs), 0);
                        Node::simple(quoted(&self.text(text), b'`', false))
                    }
                    // A number is printed in its canonical form, as its type is.
                    _ => self.type_of_pseudo_type_to_node(file, pt),
                }
            }
        }
    }

    /// `serializeReturnTypeForSignature(getSignatureFromDeclaration(func), false)`
    fn inferred_return_type_to_node(&mut self, file: FileId, func: FnId) -> Node {
        let signature = self.c.sig_of_fn(file, func);
        let declared = self.signature_parameters(signature);
        self.return_type_node(signature, &declared, false)
    }

    /// `serializeTypeForDeclaration(declaration, nil, nil, tryReuse)`
    fn type_of_declaration_to_node(
        &mut self,
        file: FileId,
        declaration: hir::Node,
        try_reuse: bool,
    ) -> Node {
        let Some(ty) = self.c.iso_type_of_declared(file, declaration) else {
            return Node::simple(b"any");
        };
        let ty = self.c.widen_literal(ty);
        let ty = self.c.instantiate(ty, self.mapper);
        self.serialize_type_for_declaration(
            file,
            declaration,
            ty,
            SerializeTypeOptions {
                try_reuse,
                is_unwidened: false,
                is_optional_reverse_mapped: false,
            },
        )
    }

    /// `pseudoTypeToNode` for a `PseudoTypeInferred` of the expression `of` that is not a
    /// signature's return type. The type is that of the declaration containing the expression,
    /// which is widened like that declaration and not like its enclosing context.
    fn inferred_pseudo_type_to_node(&mut self, file: FileId, of: hir::Node) -> Node {
        let hir = self.c.hir(file);
        let parent = hir.parent(of);
        let enclosing = match hir.kind(parent) {
            Kind::ReturnStatement => hir.get_containing_function(of),
            Kind::ArrowFunction if hir.body(parent) == of => parent,
            _ => hir::Node::NONE,
        };
        match (hir.kind(enclosing), hir.data(of)) {
            (Kind::GetAccessor | Kind::SetAccessor, _) => {
                self.type_of_declaration_to_node(file, enclosing, false)
            }
            _ if enclosing.is_some() => {
                self.inferred_return_type_to_node(file, hir.function_of(enclosing))
            }
            _ if Checker::iso_is_declaration(hir, parent) => {
                self.type_of_declaration_to_node(file, parent, false)
            }
            (_, NodeData::Expr(e)) => {
                let ty = self.c.type_of_expr(file, e);
                self.type_to_node(ty)
            }
            _ => Node::simple(b"any"),
        }
    }

    /// `typeToTypeNode(pseudoTypeToType(pt))`
    fn type_of_pseudo_type_to_node(&mut self, file: FileId, pt: &Pseudo) -> Node {
        match self.c.iso_type_of_pseudo(file, pt) {
            Some(ty) => {
                let ty = self.c.instantiate(ty, self.mapper);
                self.type_to_node(ty)
            }
            None => Node::simple(b"any"),
        }
    }

    /// The type parameters and `pseudoParametersToNodeList` of the function `func`.
    fn pseudo_signature_head(
        &mut self,
        file: FileId,
        func: FnId,
        params: &[PseudoParam],
    ) -> Vec<u8> {
        let hir = self.c.hir(file);
        let function = hir[func];
        let mut type_parameters = Vec::with_capacity(function.type_params.len());
        for tp in function.type_params.iter() {
            let reused = self.try_reuse_existing_node_helper(|printer| {
                printer.visit_type_parameter_declaration(file, tp)
            });
            let declaration = match reused {
                Some(declaration) => declaration,
                None => {
                    let parameter = self.c.declared_type_of_type_parameter(file, tp);
                    self.type_parameter_to_name(parameter)
                }
            };
            type_parameters.push(declaration);
        }
        let mut this = None;
        if function.this_ty(self.c.hir(file)).is_some() {
            let node = self.reuse_type_node(file, function.this_ty(self.c.hir(file)));
            this = Some(cat!(b"this: ", node.text));
        }
        let parameters = self.pseudo_parameters_to_text(file, this, params);
        let type_parameters = if type_parameters.is_empty() {
            Vec::new()
        } else {
            cat!(b"<", type_parameters.join(&b", "[..]), b">")
        };
        cat!(type_parameters, b"(", parameters, b")")
    }

    /// `pseudoParametersToNodeList`, as the printer emits it. `this`: a leading `this` parameter.
    fn pseudo_parameters_to_text(
        &mut self,
        file: FileId,
        this: Option<Vec<u8>>,
        params: &[PseudoParam],
    ) -> Vec<u8> {
        // `setCommentRange`
        let has_comment_range = !self.c.files().options.remove_comments
            && self.enclosing_declaration.is_some_and(|it| it.file == file);
        let indent = self.indent.filter(|_| has_comment_range);
        let mut parameters = Vec::with_capacity(params.len() + 1);
        parameters.extend(this.map(|text| Element { range: None, text }));
        for param in params {
            let loc = self.c.hir(file)[param.param].loc;
            parameters.push(Element {
                range: (indent.is_some() && loc.end != 0)
                    .then_some((loc.pos as usize, loc.end as usize)),
                text: self.pseudo_parameter_to_text(file, param),
            });
        }
        let mut writer = Writer::new(&self.c.hir(file).text[..], indent.unwrap_or(0));
        writer.emit_synthesized_parameters(&parameters);
        writer.into_text()
    }

    /// `pseudoParameterToNode`
    fn pseudo_parameter_to_text(&mut self, file: FileId, param: &PseudoParam) -> Vec<u8> {
        let declaration = self.c.hir(file)[param.param];
        self.track_parameter_declaration_name(file, param.param);
        let ty = self.pseudo_type_to_node(file, &param.ty);
        cat! {
            if declaration.flags.contains(Flags::REST) { &b"..."[..] } else { b"" },
            self.binding_name_text(file, declaration.pat),
            if param.is_optional { &b"?"[..] } else { b"" }, b": ", ty.text
        }
    }

    /// `tryReuseExistingNodeHelper` for the name of the property `p` of an object literal: the
    /// length counted is `Loc.End() - Loc.Pos()`, which includes the leading trivia.
    fn count_reused_property_name(&mut self, file: FileId, p: PropId) {
        let hir = self.c.hir(file);
        let prop = hir[p];
        let pos = if prop.start == prop.pos {
            self.pos_of_declaration(file, hir.node(p))
        } else {
            // The end of the modifier, `get`, `set` or `*` before it.
            let mut token = prop.start;
            loop {
                let end = self.c.end_of_token_at(file, token);
                let next = self.c.skip_trivia_from(file, end);
                if next >= prop.pos || next <= token {
                    break Some(end);
                }
                token = next;
            }
        };
        let end = match prop.key {
            PropKey::Computed(e) => {
                let end = self.c.end_of_expr(file, e);
                self.c.skip_trivia_from(file, end) + 1
            }
            _ => self.c.end_of_token_at(file, prop.pos),
        };
        if let Some(pos) = pos {
            self.approximate_length += end.saturating_sub(pos) as usize;
        }
    }

    /// `reuseName` for the name of the property `p` of an object literal.
    fn pseudo_property_name(&mut self, file: FileId, p: PropId, is_method: bool) -> Vec<u8> {
        self.count_reused_property_name(file, p);
        let hir = self.c.hir(file);
        let prop = hir[p];
        let PropKey::Name(name) = prop.key else {
            return self.property_key_text(file, hir.node(p).with(Part::Name));
        };
        let first = hir.text.get(prop.pos as usize).copied();
        let is_numeric = self.c.is_numeric_name(name);
        let name = self.text(name);
        // `classifyPropertyName`
        let is_new_method = is_method && name == b"new";
        if !is_new_method && is_identifier(&name) {
            return name;
        }
        let is_string_literal = matches!(first, Some(b'"' | b'\''));
        // `propertyNameNodeKindNumericLiteral`: the clone of the name is kept.
        if !is_new_method && !is_string_literal && is_numeric && !name.starts_with(b"-") {
            return match prop.name_kind {
                _ if first != Some(b'[') => name,
                NameKind::ComputedString => {
                    let literal = hir.start(hir.node(p).with(Part::NameLiteral));
                    let quote = match hir.text.get(literal as usize) {
                        Some(b'\'') => b'\'',
                        Some(b'`') => b'`',
                        _ => b'"',
                    };
                    cat!(b"[", quoted(&name, quote, false), b"]")
                }
                _ => cat!(b"[", name, b"]"),
            };
        }
        quoted(
            &name,
            if first == Some(b'\'') { b'\'' } else { b'"' },
            false,
        )
    }

    /// `pseudoTypeToNode`, of `PseudoTypeKindObjectLiteral`
    fn pseudo_object_literal_to_node(&mut self, file: FileId, elements: &[PseudoElement]) -> Node {
        let Some(first) = elements.first() else {
            return Node::simple(b"{}");
        };
        let hir = self.c.hir(file);
        let literal = self.c.bound(file).prop_owner[first.prop.idx()];
        let is_const = literal.is_some() && self.c.is_const_context(file, literal);
        let saved_flags = self.flags;
        self.flags |= IN_OBJECT_TYPE_LITERAL;
        let outer = self.indent_members();
        let mut members = Vec::with_capacity(elements.len());
        for element in elements {
            let readonly: &[u8] = if is_const { b"readonly " } else { b"" };
            // `SetCommentRange(newProp, e.Name.Parent.Loc)`
            let comments = self.comments_before(file, hir.node(element.prop));
            let member = match &element.kind {
                PseudoElementKind::Method {
                    func,
                    params,
                    returns,
                } => {
                    let name = self.pseudo_property_name(file, element.prop, !is_const);
                    let outer_scope = self.enter_scope_of_function(file, *func);
                    let head = self.pseudo_signature_head(file, *func, params);
                    let returns = self.pseudo_type_to_node(file, returns);
                    self.leave_scope(outer_scope);
                    if is_const {
                        cat!(b"readonly ", name, b": ", head, b" => ", returns.text, b";")
                    } else {
                        cat!(name, head, b": ", returns.text, b";")
                    }
                }
                PseudoElementKind::Property(ty) => {
                    // A getter without a setter.
                    let is_getter_only = match hir[hir[element.prop].value].kind {
                        ExprKind::Fn(func) if hir[element.prop].kind == PropKind::Getter => self
                            .c
                            .sibling_accessor(file, func, FnKind::Setter)
                            .is_none(),
                        _ => false,
                    };
                    let readonly = if is_getter_only {
                        b"readonly "
                    } else {
                        readonly
                    };
                    let name = self.pseudo_property_name(file, element.prop, false);
                    let ty = self.pseudo_type_to_node(file, ty);
                    cat!(readonly, name, b": ", ty.text, b";")
                }
                PseudoElementKind::Setter { param, .. } => {
                    let name = self.pseudo_property_name(file, element.prop, false);
                    let parameter =
                        self.pseudo_parameters_to_text(file, None, std::slice::from_ref(param));
                    cat!(b"set ", name, b"(", parameter, b");")
                }
                PseudoElementKind::Getter { ty, .. } => {
                    let name = self.pseudo_property_name(file, element.prop, false);
                    let ty = self.pseudo_type_to_node(file, ty);
                    cat!(b"get ", name, b"(): ", ty.text, b";")
                }
            };
            members.push(cat!(comments, member));
        }
        self.flags = saved_flags;
        self.indent = outer;
        Node::simple(self.braces(&members))
    }
}

// ───────────────────────────── reused type nodes (`nodecopy.go`) ─────────────────────────────

/// `emitPostfixTypeOperand` for the operand of a postfix type that is a parse tree node, as a
/// reused node is (`updateNode` preserves the flags): a type query is not parenthesized.
fn emit_postfix_type_operand(operand: Node) -> Vec<u8> {
    if operand.precedence == TYPE_OPERATOR && operand.text.starts_with(b"typeof ") {
        operand.text
    } else {
        operand.emit(POSTFIX)
    }
}

impl<'p> Printer<'_, 'p, '_> {
    /// `tryReuseExistingNodeHelper`, except for the length. `visit`: the visitor, applied to the
    /// node.
    fn try_reuse_existing_node_helper<T>(
        &mut self,
        visit: impl FnOnce(&mut Self) -> Option<T>,
    ) -> Option<T> {
        self.create_recovery_boundary();
        let transformed = visit(self);
        if self.finalize_boundary(transformed.is_none()) {
            transformed
        } else {
            None
        }
    }

    /// `reuseNode` for a type node.
    pub(super) fn try_reuse_type_node(&mut self, file: FileId, node: TypeNodeId) -> Option<Node> {
        self.try_reuse_existing_node_helper(|printer| {
            printer.visit_existing_type_node(file, node, 0)
        })
    }

    /// `reuseTypeNode`
    pub(super) fn reuse_type_node(&mut self, file: FileId, node: TypeNodeId) -> Node {
        if node.is_none() {
            return Node::simple(b"any");
        }
        // `finalizeBoundary`, `tryReuseExistingNodeHelper`: the length counted is the node's length
        // in the source, leading trivia included. The text of the default library is not retained.
        let length_before = self.approximate_length;
        let reused = self.try_reuse_existing_node_helper(|printer| {
            printer.visit_existing_type_node(file, node, 0)
        });
        self.approximate_length = length_before;
        match reused {
            Some(reused) => {
                let text = &self.c.hir(file).text;
                self.approximate_length += if text.is_empty() {
                    reused.text.len() + 1
                } else {
                    let start = self.c.hir(file)[node].pos as usize;
                    let pos = super::spans::start_of_leading_trivia(text, start);
                    (self.c.end_of_type_node(file, node) as usize).saturating_sub(pos)
                };
                reused
            }
            None => {
                self.report_inference_fallback(file, self.c.hir(file).node(node));
                self.resolved_type_node_to_node(file, node)
            }
        }
    }

    /// The visitor of `getExistingNodeTreeVisitor`, applied to a type node. A node that cannot be
    /// reused is printed from its type, except a type predicate, which yields `None`. `floor`: the
    /// parentheses that open before `node` enclose the construct that `node` is the first part of.
    fn visit_existing_type_node(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        floor: u32,
    ) -> Option<Node> {
        // After an error in a sibling the result is discarded.
        if self.had_error() {
            return None;
        }
        if node.is_none() {
            return Some(Node::simple(b"any"));
        }
        if self.depth >= MAXIMUM_DEPTH || self.c.is_stack_low() {
            return Some(self.elided_information_placeholder());
        }
        self.depth += 1;
        let recovery_scope = self.start_recovery_scope();
        let hir = self.c.hir(file);
        let visited = self.emit_with_leading_comments(file, hir[node].pos, |printer| {
            printer.visit_existing_type_node_worker(file, node)
        });
        self.depth -= 1;
        let mut visited = match visited {
            Some(visited) if !self.had_error() => visited,
            _ if matches!(hir[node].kind, TypeNodeKind::Predicate { .. }) => {
                self.mark_error();
                return None;
            }
            _ => {
                self.end_recovery_scope(recovery_scope);
                let serialized = self.resolved_type_node_to_node(file, node);
                // An error reported for the type counts as an error of the enclosing node.
                if self.had_error() {
                    return None;
                }
                serialized
            }
        };
        for start in self.c.parenthesized_types_around(file, node, floor) {
            visited = Node::simple(cat!(b"(", visited.text, b")"));
            self.emit_leading_comments_of_node(file, start, &mut visited);
        }
        Some(visited)
    }

    /// `emit`, which emits a node of `file` whose first token is at `start`, between
    /// `emitLeadingCommentsOfNode` and the part of `emitTrailingCommentsOfNode` that restores
    /// `containerPos`.
    fn emit_with_leading_comments(
        &mut self,
        file: FileId,
        start: u32,
        emit: impl FnOnce(&mut Self) -> Option<Node>,
    ) -> Option<Node> {
        let container_pos = self.container_pos;
        if self.is_transformer {
            self.container_pos = self.full_start(file, start as usize);
        }
        let node = emit(self);
        self.container_pos = container_pos;
        let mut node = node?;
        self.emit_leading_comments_of_node(file, start as usize, &mut node);
        Some(node)
    }

    /// `emitLeadingComments` for `node`, which is emitted for a node of `file` whose first token is
    /// at `start`. It continues a line, and a leading comment follows a line break.
    fn emit_leading_comments_of_node(&self, file: FileId, start: usize, node: &mut Node) {
        let Some(indent) = self.indent.filter(|_| self.should_emit_comments(file)) else {
            return;
        };
        let pos = self.full_start(file, start);
        if pos == self.container_pos {
            return;
        }
        let text = &self.c.hir(file).text[..];
        let comments = super::spans::get_leading_comment_ranges(text, pos);
        let comments = comments_text(text, comments, indent);
        if comments.is_empty() {
            return;
        }
        let comments = cat!(b"\n", b"    ".repeat(indent), comments);
        for emitted in std::iter::once(&mut node.text).chain(&mut node.in_extends) {
            *emitted = cat!(comments, emitted);
        }
    }

    /// `node.Pos()` of the node of `file` whose first token is at `start`.
    fn full_start(&self, file: FileId, start: usize) -> usize {
        super::spans::skip_trivia_back(&self.c.hir(file).text, start)
    }

    /// `getModuleSpecifierOverride` for the import type `node` of `file`. `None`: the literal is
    /// left unchanged.
    fn get_module_specifier_override(&mut self, file: FileId, node: TypeNodeId) -> Option<Vec<u8>> {
        let at = self
            .enclosing_declaration
            .filter(|enclosing| enclosing.file != file)?;
        let (hir, files) = (self.c.hir(file), self.c.files());
        let TypeNodeKind::Import {
            spec,
            name,
            is_typeof,
            mode,
            ..
        } = hir[node].kind
        else {
            return None;
        };
        let target = files.module_of_specifier_as(file, spec, files.mode_of_import(file, mode))?;
        // `tryGetResolvedSymbolFromTypeNode`
        let mut resolved = Some(files.module_value(target));
        for part in hir.texts(name) {
            resolved = resolved
                .and_then(|container| files.resolve_alias(container))
                .and_then(|container| files.namespace_member(files.canonical(container), part));
        }
        let resolved = resolved.and_then(|symbol| files.resolve_alias(symbol));
        let resolved = resolved.map(|symbol| files.canonical(symbol));
        let meaning = if is_typeof {
            SymFlags::VALUE
        } else {
            SymFlags::TYPE
        };
        let parent = match resolved {
            Some(symbol) if self.c.is_symbol_accessible_at(symbol, meaning, false, at) => {
                self.track_symbol(symbol, meaning);
                let (starts_with_global_this, chain) =
                    self.c
                        .lookup_symbol_chain_at(symbol, is_typeof, true, at, Vec::new());
                (!starts_with_global_this).then(|| chain[0])
            }
            _ => None,
        };
        // Otherwise `getExternalModuleFileFromDeclaration`.
        let module = parent
            .filter(|&parent| self.c.is_external_module_symbol(parent))
            .unwrap_or(target);
        let name = self
            .c
            .specifier_for_module_symbol(module, at.file, ResolutionMode::None);
        if bun_core::strings::contains(&name, b"/node_modules/") {
            self.encountered_error = true;
            self.report(Report::LikelyUnsafeImportRequired(name.clone(), Vec::new()));
        }
        (!name.is_empty() && name != self.text(spec)).then_some(name)
    }

    /// `emitImportTypeNodeAttributes` for the import type `node` of `file`, after the `, ` that
    /// `emitImportTypeNode` writes before it. Empty: `node.Attributes == nil`.
    fn import_type_attributes_text(&self, file: FileId, node: TypeNodeId) -> Vec<u8> {
        let hir = self.c.hir(file);
        let TypeNodeKind::Import {
            attributes: token, ..
        } = hir[node].kind
        else {
            return Vec::new();
        };
        let Some(object) = hir.attributes_of_import_type(node) else {
            return Vec::new();
        };
        let ExprKind::Object(attributes) = hir[object].kind else {
            return Vec::new();
        };
        // `getLiteralTextOfNode`: the node builder's clone of a string is printed from its value.
        let text_of = |start: u32, end: u32, value: Option<Atom>| {
            let written = hir.text.get(start as usize..end as usize);
            match (written.and_then(|written| written.first()), value) {
                (Some(&quote @ (b'"' | b'\'')), Some(value)) if !self.is_transformer => {
                    quoted(self.c.atoms().bytes(value), quote, false)
                }
                (None, Some(value)) => quoted(self.c.atoms().bytes(value), b'"', false),
                _ => written.unwrap_or_default().to_vec(),
            }
        };
        // `LFPreserveLines`, `LFIndented`: for nodes with positions in the file that is emitted.
        let level = self
            .indent
            .filter(|_| self.enclosing_declaration.is_some_and(|it| it.file == file));
        let line_or_space = |from: u32, to: u32, indent: usize| {
            let between = hir.text.get(from as usize..to as usize);
            match level {
                Some(level)
                    if bun_core::strings::contains_char(between.unwrap_or_default(), b'\n') =>
                {
                    cat!(b"\n", b"    ".repeat(level + indent))
                }
                _ => b" ".to_vec(),
            }
        };
        let mut list = b"{".to_vec();
        let mut previous_end = None;
        for attribute in attributes.iter().map(|p| hir[p]) {
            match previous_end {
                // `getLeadingLineTerminatorCount` compares positions only for a node without a
                // parent.
                None if self.is_transformer => list.push(b' '),
                None => list.extend(line_or_space(hir[object].pos, attribute.pos, 1)),
                // `getSeparatingLineTerminatorCount`
                Some(end) => {
                    list.push(b',');
                    list.extend(line_or_space(end, attribute.pos, 1));
                }
            }
            let value = attribute.value;
            let string = match hir[value].kind {
                ExprKind::String(text) => Some(text),
                _ => None,
            };
            let name_end = self.c.end_of_name_at(file, attribute.pos);
            let end = self.c.end_of_expr(file, value);
            list.extend(text_of(attribute.pos, name_end, attribute.key.name()));
            list.extend_from_slice(b": ");
            list.extend(text_of(self.c.start_of(file, value), end, string));
            previous_end = Some(end);
        }
        // `getClosingLineTerminatorCount`
        if let Some(end) = previous_end {
            list.extend(line_or_space(end, hir[object].end, 0));
        }
        list.push(b'}');
        let keyword: &[u8] = match token {
            ImportAttributesToken::Assert => b"assert",
            _ => b"with",
        };
        cat!(b", { ", keyword, b": ", list, b" }")
    }

    /// `visitExistingNodeTreeSymbolsWorker`, combined with the printer's emit of the result.
    fn visit_existing_type_node_worker(&mut self, file: FileId, node: TypeNodeId) -> Option<Node> {
        let hir = self.c.hir(file);
        let pos = hir[node].pos;
        Some(match hir[node].kind {
            TypeNodeKind::Error | TypeNodeKind::Heritage(_) => return None,
            TypeNodeKind::Keyword(keyword) => Node::simple(keyword.text()),
            TypeNodeKind::Ref { .. } => return self.try_visit_type_reference(file, node),
            TypeNodeKind::Typeof { .. } => return self.try_visit_type_query(file, node),
            TypeNodeKind::IndexedAccess { .. } => return self.try_visit_indexed_access(file, node),
            TypeNodeKind::Keyof(_) => return self.try_visit_key_of(file, node),
            TypeNodeKind::Import {
                spec,
                name,
                args,
                is_typeof,
                attributes: token,
                ..
            } => {
                let query: &[u8] = if is_typeof { b"typeof " } else { b"" };
                let attributes = self.import_type_attributes_text(file, node);
                // Not `IsLiteralImportTypeNode`: `VisitEachChild`. The argument is the one type in `args`.
                if spec.is_none() {
                    let argument = hir.ids(args).next()?;
                    let argument =
                        self.visit_existing_type_node(file, argument, hir[argument].pos)?;
                    let mut text = cat!(query, b"import(", argument.text, attributes, b")");
                    for part in hir.texts(name) {
                        text.push(b'.');
                        text.extend_from_slice(&self.text(part));
                    }
                    return Some(Node::simple(text));
                }
                // `assert` is deprecated: the node builder does not reuse a type that contains it.
                if token == ImportAttributesToken::Assert && !self.is_transformer {
                    return None;
                }
                let declared = self.c.type_from_node(file, node);
                if self.c.instantiate(declared, self.mapper) != declared {
                    return None;
                }
                // `rewriteModuleSpecifier`
                let specifier = match self.get_module_specifier_override(file, node) {
                    Some(name) => quoted(&name, b'"', true),
                    None => {
                        let is_quote = |&&byte: &&u8| byte == b'\'' || byte == b'"';
                        let quote = match hir.text.get(pos as usize..) {
                            Some(rest) if rest.iter().find(is_quote) == Some(&b'\'') => b'\'',
                            _ => b'"',
                        };
                        quoted(self.c.atoms().bytes(spec), quote, false)
                    }
                };
                let mut text = cat!(query, b"import(", specifier, attributes, b")");
                for part in hir.texts(name) {
                    text.push(b'.');
                    text.extend_from_slice(&self.text(part));
                }
                let arguments = self.visit_existing_type_nodes(file, args, 0)?;
                text.extend_from_slice(&type_arguments_text(arguments));
                Node::simple(text)
            }
            // Outside its declaring scope it is printed from its type, which produces the same
            // text.
            TypeNodeKind::UniqueSymbol => Node::new(b"unique symbol", TYPE_OPERATOR),
            // `getLiteralTextOfNode`: a literal of the file is printed with its source text.
            TypeNodeKind::StringLit(_) | TypeNodeKind::NumberLit(_)
                if self.is_transformer && !hir.text.is_empty() =>
            {
                let end = self.c.end_of_type_node(file, node) as usize;
                Node::simple(&hir.text[(pos as usize).min(end)..end])
            }
            TypeNodeKind::StringLit(value) => {
                let quote = match hir.text.get(pos as usize) {
                    Some(b'\'') => b'\'',
                    // A `NoSubstitutionTemplateLiteral`
                    Some(b'`') => b'`',
                    _ => b'"',
                };
                Node::simple(quoted(self.c.atoms().bytes(value), quote, false))
            }
            TypeNodeKind::NumberLit(index) => Node::simple(crate::atom::number_to_string(
                hir.numbers.get(index as usize).copied().unwrap_or(0.0),
            )),
            TypeNodeKind::BigIntLit { text, negative } => {
                let digits = self.text(text);
                let digits = digits.strip_suffix(b"n").unwrap_or(&digits);
                let sign: &[u8] = if negative { b"-" } else { b"" };
                Node::simple(cat!(sign, digits, b"n"))
            }
            TypeNodeKind::BoolLit(value) => {
                Node::simple(if value { &b"true"[..] } else { b"false" })
            }
            TypeNodeKind::Template { types, texts } => {
                let mut text = b"`".to_vec();
                for (i, piece) in hir.ids(texts).enumerate() {
                    escape_string(&self.text(piece), b'`', false, &mut text);
                    if i < types.len() {
                        let ty = self.visit_existing_type_node(file, hir.id_at(types, i), 0)?;
                        text.extend_from_slice(b"${");
                        text.extend_from_slice(&ty.text);
                        text.push(b'}');
                    }
                }
                text.push(b'`');
                Node::simple(text)
            }
            TypeNodeKind::Array(element) => {
                let element = self.visit_existing_type_node(file, element, pos)?;
                Node::new(cat!(emit_postfix_type_operand(element), b"[]"), POSTFIX)
            }
            TypeNodeKind::Readonly(of) => {
                let of = self.visit_existing_type_node(file, of, 0)?;
                Node::new(cat!(b"readonly ", of.emit(POSTFIX)), TYPE_OPERATOR)
            }
            // nodecopy.go
            TypeNodeKind::JSDoc { ty, kind, .. } => {
                let of = self.visit_existing_type_node(file, ty, pos)?;
                match kind {
                    JSDocTypeKind::Nullable => Node::union(vec![of, Node::simple(b"null")]),
                    JSDocTypeKind::NonNullable => return Some(of),
                    JSDocTypeKind::Optional => Node::union(vec![of, Node::simple(b"undefined")]),
                    JSDocTypeKind::Variadic => {
                        Node::new(cat!(emit_postfix_type_operand(of), b"[]"), POSTFIX)
                    }
                }
            }
            TypeNodeKind::Tuple(elems) => {
                let mut parts = Vec::with_capacity(elems.len());
                // `IsOriginalNodeSingleLine`: the transformer sets `EFSingleLine` in that case, the
                // node builder always.
                let text = &hir.text[..];
                let from = super::super::errors_declaration_emit::pos_before(text, pos as usize);
                let to = (self.c.end_of_type_node(file, node) as usize).clamp(from, text.len());
                let is_on_several_lines =
                    self.is_transformer && bun_core::strings::contains_char(&text[from..to], b'\n');
                let outer = match is_on_several_lines {
                    true => self.indent_members(),
                    false => self.indent,
                };
                for e in elems.iter() {
                    let elem = hir[e];
                    let start = elem.start as usize;
                    let Some(ty) = self.visit_list_element(file, elem.written, 0, start) else {
                        self.indent = outer;
                        return None;
                    };
                    let dots: &[u8] = if elem.has_dots { b"..." } else { b"" };
                    parts.push(if elem.name.is_some() {
                        let question: &[u8] = if elem.optional { b"?" } else { b"" };
                        // `emitRestType`, `emitOptionalType`
                        let ty = match elem.member_type {
                            TupleMemberType::Plain => ty.text,
                            TupleMemberType::Rest => cat!(b"...", ty.text),
                            TupleMemberType::Optional => cat!(emit_postfix_type_operand(ty), b"?"),
                        };
                        cat!(dots, self.text(elem.name), question, b": ", ty)
                    } else if elem.optional {
                        cat!(emit_postfix_type_operand(ty), b"?")
                    } else {
                        cat!(dots, ty.text)
                    });
                }
                self.indent = outer;
                match outer.filter(|_| is_on_several_lines) {
                    // `MultiLineTupleTypeElements`. `emitListRange` writes the line terminator of
                    // an empty list too.
                    Some(level) => {
                        let writes_comments = self.should_emit_comments(file);
                        // `Pos()` of an element: the end of the `[`, or of the comma before it.
                        let mut element_pos = writes_comments.then_some(pos + 1);
                        let mut elements = Vec::with_capacity(parts.len());
                        for (part, e) in parts.into_iter().zip(elems.iter()) {
                            let end = hir[e].end;
                            elements.push(Element {
                                range: element_pos.map(|pos| (pos as usize, end as usize)),
                                text: part,
                            });
                            let comma = self.c.skip_trivia_from(file, end);
                            let has_comma = text.get(comma as usize) == Some(&b',');
                            element_pos = (writes_comments && has_comma).then_some(comma + 1);
                        }
                        let mut writer = Writer::new(text, level);
                        writer.space_between_siblings = true;
                        writer.emit_list_items(&elements, b",", ListFormat::MULTI_LINE, usize::MAX);
                        Node::simple(cat!(b"[", writer.into_text(), b"    ".repeat(level), b"]"))
                    }
                    None => {
                        let ends: Vec<u32> = elems.iter().map(|e| hir[e].end).collect();
                        let (open, end) = (Some(pos + 1), usize::MAX);
                        let list = self.list_text(file, parts, &ends, open, b",", false, end);
                        Node::simple(cat!(b"[", list, b"]"))
                    }
                }
            }
            TypeNodeKind::Union(list) => {
                let nodes = self.visit_existing_type_nodes(file, list, pos)?;
                let mut union = Node::union(nodes);
                if self.is_transformer {
                    union.text =
                        self.type_node_list_text(file, node, list, union.types.clone(), b'|');
                }
                union
            }
            TypeNodeKind::Intersection(list) => {
                let nodes = self.visit_existing_type_nodes(file, list, pos)?;
                if self.is_transformer {
                    let parts = nodes.into_iter().map(|it| it.emit(TYPE_OPERATOR)).collect();
                    let text = self.type_node_list_text(file, node, list, parts, b'&');
                    return Some(Node::new(text, INTERSECTION));
                }
                Node::new(join_nodes(nodes, b" & ", TYPE_OPERATOR), INTERSECTION)
            }
            TypeNodeKind::Fn(f) => {
                let outer_scope = self.enter_scope_of_function(file, f);
                let head = self.visit_signature_head(file, f);
                let returned = self.visit_existing_type_node(file, hir[f].ret, 0);
                self.leave_scope(outer_scope);
                let (head, returned) = (head?, returned?);
                let keywords: &[u8] = match hir[f].kind {
                    FnKind::ConstructorType if hir[f].flags.contains(Flags::ABSTRACT) => {
                        b"abstract new "
                    }
                    FnKind::ConstructorType => b"new ",
                    _ => b"",
                };
                Node::function(&cat!(keywords, head, b" => "), returned)
            }
            TypeNodeKind::Object(members) => {
                let scope = self.c.bound(file).type_scope[node.idx()];
                let mut elements = Vec::with_capacity(members.len());
                let outer = self.indent_members();
                for m in members.iter() {
                    if self.is_transformer && self.c.should_strip_internal(file, hir[m].loc.pos) {
                        continue;
                    }
                    // `visitDeclarationSubtree`: `HasDynamicName`, `IsLateBound`
                    if self.is_transformer
                        && !self.c.files().options.isolated_declarations
                        && let PropKey::Computed(name) = hir[m].key
                        && is_dynamic_name(hir, name)
                        && !(is_entity_name_expression(hir, name)
                            && self.c.member_name(file, hir[m].key).is_some())
                    {
                        continue;
                    }
                    let outer_scope = hir[m]
                        .func
                        .some()
                        .map(|f| self.enter_scope_of_function(file, f));
                    let element = self.visit_type_element(file, m, scope);
                    if let Some(outer_scope) = outer_scope {
                        self.leave_scope(outer_scope);
                    }
                    let Some(element) = element else {
                        self.indent = outer;
                        return None;
                    };
                    let comments = self.comments_before(file, hir.node(m));
                    elements.push(cat!(comments, self.partial_jsdoc(file, m), element));
                }
                self.indent = outer;
                if elements.is_empty() {
                    Node::simple(b"{}")
                } else {
                    Node::simple(self.braces(&elements))
                }
            }
            TypeNodeKind::Cond {
                check,
                extends,
                yes,
                no,
            } => {
                let check = self.visit_existing_type_node(file, check, pos)?;
                let mut declared = Vec::new();
                self.c.collect_infer_params(file, extends, &mut declared);
                let infer_type_parameters: Vec<TypeId> = declared
                    .into_iter()
                    .map(|parameter| self.c.type_param(file, parameter))
                    .collect();
                let outer_scope = self.enter_new_scope(&[], &infer_type_parameters, None, false);
                let extends = self.visit_existing_type_node(file, extends, 0);
                let yes = self.visit_existing_type_node(file, yes, 0);
                self.leave_scope(outer_scope);
                let (extends, yes) = (extends?, yes?);
                let no = self.visit_existing_type_node(file, no, 0)?;
                Node::new(
                    cat! {
                        check.emit(UNION), b" extends ", extends.emit_in_extends(), b" ? ",
                        yes.text, b" : ", no.text
                    },
                    CONDITIONAL,
                )
            }
            TypeNodeKind::Infer(tp) => {
                let parameter = self.c.declared_type_of_type_parameter(file, tp);
                let name = self.type_parameter_to_name(parameter);
                if hir[tp].constraint.is_none() {
                    Node::new(cat!(b"infer ", name), TYPE_OPERATOR)
                } else {
                    let constraint = self.visit_existing_type_node(file, hir[tp].constraint, 0)?;
                    Node::new(
                        cat!(b"infer ", name, b" extends ", constraint.emit_in_extends()),
                        FUNCTION,
                    )
                }
            }
            TypeNodeKind::Mapped(m) => {
                let mapped = hir[m];
                let key = self.c.type_param(file, mapped.param);
                let outer_scope = self.enter_new_scope(&[], &[key], None, false);
                let name = self.type_parameter_to_name(key);
                // The node builder sets `EFSingleLine` on its copy, not on what is inside. The
                // transformer leaves the node unchanged.
                let outer = match self.is_transformer {
                    true => self.indent_members(),
                    false => self.indent,
                };
                let constraint =
                    self.visit_existing_type_node(file, hir[mapped.param].constraint, 0);
                let name_type = self.visit_existing_type_node(file, mapped.name_ty, 0);
                let template = self.visit_existing_type_node(file, mapped.ty, 0);
                self.indent = outer;
                self.leave_scope(outer_scope);
                let (constraint, name_type, template) = (constraint?, name_type?, template?);
                let renamed = if mapped.name_ty.is_some() {
                    cat!(b" as ", name_type.text)
                } else {
                    Vec::new()
                };
                let (readonly, question) = (mapped.readonly_text(), mapped.question_text());
                let member = cat! {
                    readonly, b"[", name, b" in ", constraint.text, renamed, b"]", question,
                    b": ", template.text, b";"
                };
                Node::simple(if self.is_transformer {
                    self.braces(&[member])
                } else {
                    cat!(b"{ ", member, b" }")
                })
            }
            TypeNodeKind::Predicate { param, ty, asserts } => {
                let mut text = Vec::new();
                if asserts {
                    text.extend_from_slice(b"asserts ");
                }
                text.extend_from_slice(&self.text(param));
                if ty.is_some() {
                    let ty = self.visit_existing_type_node(file, ty, 0)?;
                    text.extend_from_slice(b" is ");
                    text.extend_from_slice(&ty.text);
                }
                Node::simple(text)
            }
        })
    }

    /// `list_text` for the constituents `list` of the union or intersection `node`, or for the type
    /// arguments of the reference `node`.
    /// `token`: `|`, `&`, or the `<` that precedes the arguments.
    fn type_node_list_text(
        &self,
        file: FileId,
        node: TypeNodeId,
        list: IdList<TypeNodeId>,
        parts: Vec<Vec<u8>>,
        token: u8,
    ) -> Vec<u8> {
        let hir = self.c.hir(file);
        let ends: Vec<u32> = (hir.ids(list))
            .map(|it| self.c.end_of_type_node(file, it))
            .collect();
        let start = hir[node].pos;
        let (first_pos, delimiter): (Option<u32>, &[u8]) = match token {
            b'<' => {
                let open = bun_core::strings::index_of_char(&hir.text[start as usize..], b'<');
                (open.map(|open| start + open + 1), b",")
            }
            // A leading `|` or `&`.
            _ => (
                (hir.text.get(start as usize) == Some(&token)).then_some(start + 1),
                if token == b'|' { b" |" } else { b" &" },
            ),
        };
        // The last constituent ends at the end of the union or intersection, which emits its
        // trailing comments.
        let parent_end = match (token, ends.last()) {
            (b'|' | b'&', Some(&end)) => end as usize,
            _ => usize::MAX,
        };
        self.list_text(file, parts, &ends, first_pos, delimiter, false, parent_end)
    }

    fn visit_existing_type_nodes(
        &mut self,
        file: FileId,
        list: IdList<TypeNodeId>,
        floor: u32,
    ) -> Option<Vec<Node>> {
        let hir = self.c.hir(file);
        let mut nodes = Vec::with_capacity(list.len());
        for node in hir.ids(list) {
            if !self.is_transformer {
                nodes.push(self.visit_existing_type_node(file, node, floor)?);
                continue;
            }
            let outermost = (self.c.parenthesized_types_around(file, node, floor)).last();
            let start = outermost.unwrap_or(hir[node].pos as usize);
            nodes.push(self.visit_list_element(file, node, floor, start)?);
        }
        Some(nodes)
    }

    /// `visit_existing_type_node` for `node`, which is an element of a list or a part of one. The
    /// first token of the element is at `start`. `emit_list_items` emits its comments.
    fn visit_list_element(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        floor: u32,
        start: usize,
    ) -> Option<Node> {
        let container_pos = self.container_pos;
        if self.is_transformer {
            self.container_pos = self.full_start(file, start);
        }
        let visited = self.visit_existing_type_node(file, node, floor);
        self.container_pos = container_pos;
        visited
    }

    /// `enterNewScope` for the function-like `f`. Pass the result to `leave_scope`.
    fn enter_scope_of_function(&mut self, file: FileId, f: FnId) -> OuterScope {
        let function = self.c.hir(file)[f];
        let parameters: Vec<Option<(FileId, ParamId)>> =
            function.params.iter().map(|p| Some((file, p))).collect();
        let type_parameters: Vec<TypeId> = function
            .type_params
            .iter()
            .map(|tp| self.c.declared_type_of_type_parameter(file, tp))
            .collect();
        self.enter_new_scope(&parameters, &type_parameters, None, false)
    }

    /// A `TypeParameterDeclaration`
    pub(super) fn visit_type_parameter_declaration(
        &mut self,
        file: FileId,
        tp: TypeParamId,
    ) -> Option<Vec<u8>> {
        let hir = self.c.hir(file);
        let declaration = hir[tp];
        let mut text = Vec::new();
        // `emitModifierList`: as written, also those that are errors.
        for modifier in hir.modifier_list(declaration.modifiers) {
            if let ModifierKind::Keyword(flag) = modifier.kind {
                text.extend_from_slice(modifier_text(flag).as_bytes());
                text.push(b' ');
            }
        }
        let parameter = self.c.declared_type_of_type_parameter(file, tp);
        text.extend_from_slice(&self.type_parameter_to_name(parameter));
        if declaration.constraint.is_some() {
            let constraint = self.visit_existing_type_node(file, declaration.constraint, 0)?;
            text.extend_from_slice(b" extends ");
            text.extend_from_slice(&constraint.text);
        }
        if declaration.default.is_some() {
            let default = self.visit_existing_type_node(file, declaration.default, 0)?;
            text.extend_from_slice(b" = ");
            text.extend_from_slice(&default.text);
        }
        Some(text)
    }

    /// The type of `node`, a declaration inside a type node. `annotation`: `node.Type()`. The
    /// visitor of the node builder visits that, and prints `any` if there is none. The transformer
    /// has `ensureType`, which hands over to the node builder in a JavaScript file and where
    /// there is no annotation.
    fn ensure_type(
        &mut self,
        file: FileId,
        node: hir::Node,
        annotation: TypeNodeId,
    ) -> Option<Node> {
        if !self.is_transformer {
            return self.visit_existing_type_node(file, annotation, 0);
        }
        let hir = self.c.hir(file);
        let is_annotated = annotation.is_some()
            && !matches!(hir.data(node), NodeData::Param(p)
                if self.c.requires_adding_implicit_undefined(file, p, self.enclosing_declaration));
        if is_annotated && !hir.is_js {
            return self.visit_existing_type_node(file, annotation, 0);
        }
        self.is_transformer = false;
        // `TryJSTypeNodeToTypeNode`
        let reused = match is_annotated {
            true => self.try_reuse_type_node(file, annotation),
            false => None,
        };
        let ty = match (reused, hir.function_of(node).some()) {
            (Some(reused), _) => reused,
            // `CreateTypeOfDeclaration`
            _ if self.c.iso_has_inferred_type(file, node) => {
                self.type_of_declaration_to_node(file, node, true)
            }
            // `CreateReturnTypeOfSignatureDeclaration`
            (None, Some(f)) => {
                let signature = self.c.sig_of_declaration(file, f);
                self.serialize_return_type_for_signature(signature)
            }
            (None, None) => Node::simple(b"any"),
        };
        self.is_transformer = true;
        Some(ty)
    }

    /// A `ParameterDeclaration`
    fn visit_parameter_declaration(&mut self, file: FileId, p: ParamId) -> Option<Vec<u8>> {
        let parameter = self.c.hir(file)[p];
        let ty = self.ensure_type(file, self.c.hir(file).node(p), parameter.ty)?;
        Some(cat! {
            if parameter.flags.contains(Flags::REST) { &b"..."[..] } else { b"" },
            self.binding_name_text(file, parameter.pat),
            if parameter.flags.contains(Flags::OPTIONAL) { &b"?"[..] } else { b"" }, b": ", ty.text
        })
    }

    fn visit_parameter_declarations(&mut self, file: FileId, f: FnId) -> Option<Vec<u8>> {
        let function = self.c.hir(file)[f];
        let mut parameters = Vec::with_capacity(function.params.len() + 1);
        if function.this_ty(self.c.hir(file)).is_some() {
            let this =
                self.visit_existing_type_node(file, function.this_ty(self.c.hir(file)), 0)?;
            parameters.push(cat!(b"this: ", this.text));
        }
        let has_this = !parameters.is_empty();
        for p in function.params.iter() {
            parameters.push(self.visit_parameter_declaration(file, p)?);
        }
        let hir = self.c.hir(file);
        let ends: Vec<u32> = function.params.iter().map(|p| hir[p].loc.end).collect();
        if has_this || function.params.iter().any(|p| hir[p].loc.end == 0) {
            return Some(parameters.join(&b", "[..]));
        }
        let first_pos = function.params.iter().next().map(|p| hir[p].loc.pos);
        Some(self.list_text(file, parameters, &ends, first_pos, b",", false, usize::MAX))
    }

    /// The type parameters and the parameters of the function-like `f`.
    fn visit_signature_head(&mut self, file: FileId, f: FnId) -> Option<Vec<u8>> {
        let type_params = self.c.hir(file)[f].type_params;
        let mut type_parameters = Vec::with_capacity(type_params.len());
        for tp in type_params.iter() {
            type_parameters.push(self.visit_type_parameter_declaration(file, tp)?);
        }
        let parameters = self.visit_parameter_declarations(file, f)?;
        Some(if type_parameters.is_empty() {
            cat!(b"(", parameters, b")")
        } else {
            cat! { b"<", type_parameters.join(&b", "[..]), b">(", parameters, b")" }
        })
    }

    /// A member of a type literal. `None`: the type literal is printed from its type.
    fn visit_type_element(&mut self, file: FileId, m: MemberId, scope: ScopeId) -> Option<Vec<u8>> {
        let hir = self.c.hir(file);
        let member = hir[m];
        let readonly: &[u8] = if member.flags.contains(Flags::READONLY) {
            b"readonly "
        } else {
            b""
        };
        let question: &[u8] = if member.flags.contains(Flags::OPTIONAL) {
            b"?"
        } else {
            b""
        };
        let name = match member.key {
            // A string keeps its quotes and is re-escaped, a number is printed in its canonical
            // form.
            PropKey::Name(name) => match hir.text.get(hir[m].name_pos as usize) {
                Some(b'\'') => quoted(&self.text(name), b'\'', false),
                Some(b'"') => quoted(&self.text(name), b'"', false),
                Some(b'[') => self.property_key_text(file, hir.name(hir.node(m))),
                _ if member.flags.contains(Flags::STRING_NAME) => {
                    quoted(&self.text(name), b'"', false)
                }
                _ => self.text(name),
            },
            // `#x` outside a class declares nothing (`getDeclarationName`). The node has the name
            // anyway.
            PropKey::None if is_private_name_at(hir, hir[m].name_pos) => {
                self.property_key_text(file, hir.node(m).with(Part::Name))
            }
            PropKey::None => Vec::new(),
            PropKey::Computed(e) => {
                let name = self.entity_name_text(file, e)?;
                let first = first_identifier(hir, e);
                let ExprKind::Ident(first) = hir[first].kind else {
                    return None;
                };
                let node = hir.node(e);
                if self.track_existing_entity_name(file, node, scope, first, SymFlags::VALUE) {
                    return None;
                }
                cat!(b"[", name, b"]")
            }
            PropKey::Private(_) => self.property_key_text(file, hir.name(hir.node(m))),
        };
        let is_named = !name.is_empty();
        if member.func.is_none() && member.kind != MemberKind::Property {
            return None;
        }
        Some(match member.kind {
            MemberKind::Property if is_named => {
                let ty = self.ensure_type(file, hir.node(m), member.ty)?;
                cat!(readonly, name, question, b": ", ty.text, b";")
            }
            MemberKind::Method if is_named => {
                let head = self.visit_signature_head(file, member.func)?;
                let returned = self.ensure_type(file, hir.node(m), hir[member.func].ret)?;
                cat!(name, question, head, b": ", returned.text, b";")
            }
            MemberKind::CallSignature => {
                let head = self.visit_signature_head(file, member.func)?;
                let returned = self.ensure_type(file, hir.node(m), hir[member.func].ret)?;
                cat!(head, b": ", returned.text, b";")
            }
            MemberKind::ConstructSignature => {
                let head = self.visit_signature_head(file, member.func)?;
                let returned = self.ensure_type(file, hir.node(m), hir[member.func].ret)?;
                cat!(b"new ", head, b": ", returned.text, b";")
            }
            MemberKind::IndexSignature => {
                let parameters = self.visit_parameter_declarations(file, member.func)?;
                let value = self.visit_existing_type_node(file, hir[member.func].ret, 0)?;
                cat!(readonly, b"[", parameters, b"]: ", value.text, b";")
            }
            // An accessor without a type annotation is printed without one.
            MemberKind::Getter if is_named => {
                let returned = hir[member.func].ret;
                if returned.is_none() {
                    cat!(b"get ", name, b"();")
                } else {
                    let returned = self.ensure_type(file, hir.node(m), returned)?;
                    cat!(b"get ", name, b"(): ", returned.text, b";")
                }
            }
            MemberKind::Setter if is_named => {
                let parameters = self.visit_parameter_declarations(file, member.func)?;
                cat!(b"set ", name, b"(", parameters, b");")
            }
            _ => return None,
        })
    }

    /// `tryVisitSimpleTypeNode`. `None`: neither `node` nor the type it is the operand of can be
    /// reused.
    fn try_visit_simple_type_node(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        floor: u32,
    ) -> Option<Node> {
        // `SkipParentheses` skips no `ParenthesizedType`.
        if (self.c.parenthesized_types_around(file, node, floor))
            .next()
            .is_some()
        {
            return self.visit_existing_type_node(file, node, floor);
        }
        let hir = self.c.hir(file);
        let visit: fn(&mut Self, FileId, TypeNodeId) -> Option<Node> = match hir[node].kind {
            TypeNodeKind::Ref { .. } => Self::try_visit_type_reference,
            TypeNodeKind::Typeof { .. } => Self::try_visit_type_query,
            TypeNodeKind::IndexedAccess { .. } => Self::try_visit_indexed_access,
            TypeNodeKind::Keyof(_) => Self::try_visit_key_of,
            _ => return self.visit_existing_type_node(file, node, floor),
        };
        self.emit_with_leading_comments(file, hir[node].pos, |printer| visit(printer, file, node))
    }

    /// `tryVisitIndexedAccess`
    fn try_visit_indexed_access(&mut self, file: FileId, node: TypeNodeId) -> Option<Node> {
        let hir = self.c.hir(file);
        let TypeNodeKind::IndexedAccess { obj, index } = hir[node].kind else {
            return None;
        };
        let object = self.try_visit_simple_type_node(file, obj, hir[node].pos)?;
        let index = self.visit_existing_type_node(file, index, 0)?;
        Some(Node::new(
            cat!(emit_postfix_type_operand(object), b"[", index.text, b"]"),
            POSTFIX,
        ))
    }

    /// `tryVisitKeyOf`
    fn try_visit_key_of(&mut self, file: FileId, node: TypeNodeId) -> Option<Node> {
        let TypeNodeKind::Keyof(of) = self.c.hir(file)[node].kind else {
            return None;
        };
        let of = self.try_visit_simple_type_node(file, of, 0)?;
        Some(Node::new(
            cat!(b"keyof ", of.emit(TYPE_OPERATOR)),
            TYPE_OPERATOR,
        ))
    }

    /// `tryVisitTypeQuery`
    fn try_visit_type_query(&mut self, file: FileId, node: TypeNodeId) -> Option<Node> {
        let hir = self.c.hir(file);
        let TypeNodeKind::Typeof {
            name, args, expr, ..
        } = hir[node].kind
        else {
            return None;
        };
        let names: Vec<Atom> = hir.texts(name).collect();
        let &first = names.first()?;
        let scope = self.c.bound(file).type_scope[node.idx()];
        // `visitDeclarationSubtree` leaves the name as it is.
        let introduces_error = if self.is_transformer {
            false
        } else if first == known::this {
            // Errors reported for it are discarded when the node is printed from its type.
            if !self.is_this_container_accessible(file, node) {
                return None;
            }
            false
        } else {
            self.track_existing_entity_name(file, hir.node(expr), scope, first, SymFlags::VALUE)
        };
        let arguments = self.visit_existing_type_nodes(file, args, 0)?;
        if introduces_error {
            return self.serialize_type_name(file, scope, &names, true, arguments);
        }
        let path: Vec<Vec<u8>> = names.iter().map(|&name| self.text(name)).collect();
        Some(Node::new(
            cat! { b"typeof ", path.join(&b"."[..]), type_arguments_text(arguments) },
            TYPE_OPERATOR,
        ))
    }

    /// `trackExistingEntityName` for the name after `typeof` in `query`, which starts with `this`:
    /// whether the symbol of `getThisContainer` is accessible where the name is printed. A member
    /// has no symbol: it is as accessible as its container (`getContainersOfSymbol`).
    fn is_this_container_accessible(&mut self, file: FileId, query: TypeNodeId) -> bool {
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        let TypeNodeKind::Typeof { expr, .. } = hir[query].kind else {
            return false;
        };
        let scope = bound.type_scope[query.idx()];
        let this = first_identifier(hir, expr);
        let symbol = match self.c.this_container(file, this) {
            Some(Ok(f)) => match bound.fns[f.idx()].owner {
                FnOwner::Stmt(_) => bound.fn_symbol[f.idx()],
                FnOwner::Member(m) => match bound.member_owner[m.idx()] {
                    MemberOwner::Class(c) => bound.class_symbol[c.idx()],
                    MemberOwner::Interface(i) => bound.interface_symbol[i.idx()],
                    _ => SymbolId::NONE,
                },
                _ => SymbolId::NONE,
            },
            Some(Err((c, _))) => bound.class_symbol[c.idx()],
            _ => SymbolId::NONE,
        };
        symbol.is_some() && scope.is_some() && {
            let symbol = self.c.files().sym(file, symbol);
            let at = Enclosing::at_scope(file, scope);
            self.c
                .is_symbol_accessible_at(symbol, SymFlags::VALUE, false, at)
        }
    }

    /// `tryVisitTypeReference`
    fn try_visit_type_reference(&mut self, file: FileId, node: TypeNodeId) -> Option<Node> {
        let (hir, files) = (self.c.hir(file), self.c.files());
        let TypeNodeKind::Ref { name, args } = hir[node].kind else {
            return None;
        };
        let names: Vec<Atom> = hir.texts(name).collect();
        let &first = names.first()?;
        // The node builder replaces a reference whose name is missing. `transformTypeReference`
        // leaves it unchanged, and it is printed as nothing.
        if !self.is_transformer && names.contains(&known::empty) {
            return Some(Node::simple(b"any"));
        }
        let scope = self.c.bound(file).type_scope[node.idx()];
        let declared = self.c.type_from_node(file, node);
        let is_type_parameter = files
            .resolve_entity(file, scope, &names, SymFlags::TYPE)
            .is_some_and(|symbol| files.flags(symbol).contains(SymFlags::TYPE_PARAMETER));
        // The type parameter of a class is not in scope in a static member: it is an unresolved
        // name there.
        let variable = self.c.actual_type_variable(declared);
        if is_type_parameter && matches!(self.c.data(variable), TypeData::TypeParam(..)) {
            // A type parameter that the mapper of the signature being printed maps represents
            // another type.
            if self.c.instantiate(variable, self.mapper) != variable {
                return None;
            }
            let name = self.type_parameter_to_name(variable);
            return Some(Node {
                text: name.clone(),
                precedence: NON_ARRAY,
                reference: Some(name),
                types: Vec::new(),
                in_extends: None,
            });
        }
        if !self.c.can_reuse_existing_js_type_node(file, node, declared) {
            return None;
        }
        let meaning = if names.len() == 1 {
            SymFlags::TYPE
        } else {
            SymFlags::NAMESPACE
        };
        let introduces_error =
            self.track_existing_entity_name(file, hir.node(name), scope, first, meaning);
        let arguments = self.visit_existing_type_nodes(file, args, 0)?;
        if introduces_error {
            return self.serialize_type_name(file, scope, &names, false, arguments);
        }
        let path: Vec<Vec<u8>> = names.iter().map(|&name| self.text(name)).collect();
        let arguments = if self.is_transformer && !arguments.is_empty() {
            let parts = arguments
                .into_iter()
                .map(|it| it.emit(CONDITIONAL))
                .collect();
            cat!(
                b"<",
                self.type_node_list_text(file, node, args, parts, b'<'),
                b">"
            )
        } else {
            type_arguments_text(arguments)
        };
        Some(Node {
            text: cat!(path.join(&b"."[..]), arguments),
            precedence: NON_ARRAY,
            reference: match &path[..] {
                [only] => Some(only.clone()),
                _ => None,
            },
            types: Vec::new(),
            in_extends: None,
        })
    }

    /// `reuseNode` for the computed property name `[name]` in `file`, where `name` is an entity
    /// name expression. `None`: it resolves differently, or is inaccessible, where the type is
    /// printed.
    pub(super) fn reuse_computed_property_name(
        &mut self,
        file: FileId,
        name: ExprId,
    ) -> Option<Vec<u8>> {
        let hir = self.c.hir(file);
        let first = first_identifier(hir, name);
        let ExprKind::Ident(first) = hir[first].kind else {
            return None;
        };
        let scope = self.c.enclosing_scope_of_expr(file, name);
        let node = hir.node(name);
        self.try_reuse_existing_node_helper(|printer| {
            let introduces_error =
                printer.track_existing_entity_name(file, node, scope, first, SymFlags::VALUE);
            (!introduces_error).then_some(())
        })?;
        let text = cat!(b"[", self.entity_name_text(file, name)?, b"]");
        self.approximate_length += text.len();
        Some(text)
    }

    /// `trackExistingEntityName` for the name `node` that starts with `first` and occurs in `scope`
    /// of `file`: whether it resolves differently, or is inaccessible, where the type is printed.
    fn track_existing_entity_name(
        &mut self,
        file: FileId,
        node: hir::Node,
        scope: ScopeId,
        first: Atom,
        meaning: SymFlags,
    ) -> bool {
        let files = self.c.files();
        let here = (self.c.resolve(file, scope, first, meaning, false)).unwrap_or(None);
        // A type parameter is not resolved again.
        if here.is_some_and(|symbol| files.flags(symbol).contains(SymFlags::TYPE_PARAMETER)) {
            return false;
        }
        // `IsSymbolAccessible`: without an enclosing declaration every symbol is accessible.
        let Some(at) = self.enclosing_declaration else {
            return false;
        };
        let parameter = self
            .fake_scope_parameters
            .iter()
            .rev()
            .find(|local| local.0 == first && meaning == SymFlags::VALUE);
        let there = match parameter {
            Some(&(_, Some(parameter))) => Some(parameter),
            Some(&(_, None)) => return here.is_some(),
            None => (self.c.resolve(at.file, at.scope, first, meaning, false)).unwrap_or(None),
        };
        let symbol = match (there, here) {
            (None, None) => return false,
            // `getSymbolIfSameReference`
            (Some(there), Some(here))
                if there == here
                    || files.export_symbol_of_value_symbol_if_exported(there)
                        == files.export_symbol_of_value_symbol_if_exported(here)
                    || self.c.resolve_alias(there) == self.c.resolve_alias(here) =>
            {
                there
            }
            (Some(there), None) => there,
            _ => {
                self.report_inference_fallback(file, node);
                return true;
            }
        };
        // A parameter that resolves is visible.
        if files.flags(symbol).contains(SymFlags::PARAMETER) {
            return false;
        }
        if !self.c.is_symbol_accessible_at(symbol, meaning, true, at) {
            self.report_inference_fallback(file, node);
            return true;
        }
        self.track_symbol(symbol, meaning);
        false
    }

    /// `serializeTypeName` for the entity name `names` in `scope` of `file`. `None`: its symbol
    /// cannot be named where the type is printed.
    fn serialize_type_name(
        &mut self,
        file: FileId,
        scope: ScopeId,
        names: &[Atom],
        is_type_of: bool,
        type_arguments: Vec<Node>,
    ) -> Option<Node> {
        let files = self.c.files();
        let at = self.enclosing_declaration?;
        let meaning = if is_type_of {
            SymFlags::VALUE
        } else {
            SymFlags::TYPE
        };
        // `resolveEntityName`: `if namespace == c.unknownSymbol { return namespace }`
        let is_qualified_by_unknown_symbol = (1..names.len()).any(|count| {
            let namespace = SymFlags::NAMESPACE;
            let qualifier = files.resolve_entity(file, scope, &names[..count], namespace);
            qualifier.is_some_and(|it| matches!(self.c.resolve_alias(it), AliasTarget::Unknown))
        });
        let symbol = if is_qualified_by_unknown_symbol {
            files.unknown_symbol
        } else {
            let found = files.resolve_entity(file, scope, names, meaning)?;
            // An alias that does not itself have the meaning is resolved.
            match files.resolve_alias_as(found, meaning) {
                Some(symbol) => symbol,
                None if matches!(self.c.resolve_alias(found), AliasTarget::Unknown) => {
                    files.unknown_symbol
                }
                None => found,
            }
        };
        if !self.c.is_symbol_accessible_at(symbol, meaning, false, at) {
            return None;
        }
        let resolved = files.canonical(files.resolve_alias(symbol).unwrap_or(symbol));
        Some(self.symbol_to_type_node(resolved, is_type_of, type_arguments))
    }
}

impl Checker<'_, '_> {
    /// `canReuseExistingJSTypeNode`: false for a node that represents a different type in a JSDoc
    /// comment, and for a reference to the target of `ty` with too few type arguments.
    fn can_reuse_existing_js_type_node(
        &mut self,
        file: FileId,
        existing: TypeNodeId,
        ty: TypeId,
    ) -> bool {
        let (hir, files) = (self.hir(file), self.files());
        let TypeNodeKind::Ref { name, args } = hir[existing].kind else {
            return true;
        };
        if self
            .get_intended_type_from_jsdoc_type_reference(file, existing)
            .is_some()
        {
            return false;
        }
        let target = match self.data(ty) {
            TypeData::Ref { target, .. } => *target,
            _ => return true,
        };
        let names: Vec<Atom> = hir.texts(name).collect();
        let scope = self.bound(file).type_scope[existing.idx()];
        let Some(found) = files.resolve_entity(file, scope, &names, SymFlags::TYPE) else {
            return true;
        };
        let named = files.resolve_alias_as(found, SymFlags::TYPE);
        if named.map(|named| files.canonical(named)) != Some(target) {
            return true;
        }
        let type_parameters = self.all_type_params_of_symbol(target);
        args.len() >= self.min_type_argument_count(&type_parameters)
    }
}

//! What the node builder does with a declared type where it has an enclosing declaration. The type is read off the syntax
//! (`pseudochecker`), held against what the checker says (`pseudoTypeEquivalentToType`) and, if the two agree, written as the source
//! writes it (`pseudotypenodebuilder.go`, `nodecopy.go`). The pseudochecker is the one `isolatedDeclarations` is checked with.

use super::super::errors_isolated_declarations::{
    Emit, Pseudo, PseudoElement, PseudoElementKind, PseudoParam,
};
use super::super::errors_misc::QueriedThisContainer;
use super::super::errors_x_properties_jsx::start_of_member_name;
use super::*;

// ───────────────────────────── declarations (`nodebuilderimpl.go`) ─────────────────────────────

impl<'p> Printer<'_, 'p> {
    /// Whether what `file` declares is read off its syntax. Not in a JSON file, whose nodes have no positions.
    fn reuses_nodes_of(&self, file: FileId) -> bool {
        self.enclosing_declaration.is_some() && self.c.hir(file).kind != FileKind::Json
    }

    /// `symbolToParameterDeclaration`: the type of `parameter`.
    pub(super) fn serialize_type_of_parameter(&mut self, parameter: &Parameter) -> Node {
        match parameter.declaration {
            Some((file, declaration)) if self.reuses_nodes_of(file) => self
                .serialize_type_for_declaration(
                    file,
                    SyntaxNode::Param(declaration),
                    parameter.ty,
                    true,
                    false,
                    false,
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
            && self.reuses_nodes_of(file)
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
        if self.enclosing_declaration.is_some()
            && let Some((file, declaration)) = self.value_declaration_of_property(prop, 0)
            && self.reuses_nodes_of(file)
        {
            // The properties of an object literal that has not been widened have not been either.
            let is_unwidened = matches!(
                self.c.data(owner),
                TypeData::Anon {
                    origin: Origin::ObjectLiteral(..),
                    ..
                }
            );
            // `symbol.Flags&SymbolFlagsOptional != 0 && ReverseMappedSymbolLinks.Has(symbol)`
            let is_optional_reverse_mapped = prop.flags.contains(PropFlags::OPTIONAL)
                && matches!(self.c.data(owner), TypeData::ReverseMapped { .. });
            return self.serialize_type_for_declaration(
                file,
                declaration,
                ty,
                true,
                is_unwidened,
                is_optional_reverse_mapped,
            );
        }
        self.type_to_node(ty)
    }

    /// `addPropertyToElementList`: what the getter of `prop` returns or its setter takes, whichever is of `kind`. It is `ty`.
    pub(super) fn serialize_type_of_accessor(
        &mut self,
        prop: &Prop,
        kind: MemberKind,
        ty: TypeId,
    ) -> Node {
        // `GetDeclarationOfKind`
        let declaration = match prop.source {
            PropSource::Members(ref list) => list
                .iter()
                .find(|&&(file, member)| self.c.hir(file)[member].kind == kind)
                .map(|&(file, member)| (file, SyntaxNode::Member(member))),
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
                    .map(|declaration| (file, SyntaxNode::Prop(declaration)))
            }
            _ => None,
        };
        if self.enclosing_declaration.is_some()
            && let Some((file, declaration)) = declaration
            && self.reuses_nodes_of(file)
        {
            return self.serialize_type_for_declaration(file, declaration, ty, true, false, false);
        }
        self.type_to_node(ty)
    }

    /// `serializeReturnTypeForSignature`, as far as it goes by the syntax. `None`: the checker is asked.
    pub(super) fn try_reuse_return_type_of_signature(
        &mut self,
        signature: SigId,
    ) -> Option<String> {
        let (file, func, _) = self.c.sig_decl(signature)?;
        if !self.reuses_nodes_of(file) {
            return None;
        }
        let tx = Emit::without_reports(file);
        let pt = self.c.iso_pseudo_of_return(&tx, func);
        let returned = self.c.sig_return(signature);
        // `getReturnTypeOfSignature`: an annotation that comes back to itself is given up for `anyType`, which is not what it says.
        if self.c.p.circular_returns.get(&(file, func)).is_some() {
            return None;
        }
        let report_errors = !self.suppress_report_inference_fallback;
        if !self.pseudo_type_equivalent_to_type(file, &pt, returned, false, report_errors) {
            return None;
        }
        // The pseudochecker knows nothing of a predicate that is inferred.
        if let Some(predicate) = self.c.sig_predicate(signature)
            && !self
                .c
                .iso_matches_predicate(file, &pt, signature, predicate)
        {
            if !self.suppress_report_inference_fallback {
                let declaration = self.c.iso_node_of_fn(file, func);
                self.report_inference_fallback(file, declaration);
            }
            return None;
        }
        Some(
            self.pseudo_type_to_node_with_checker_fallback(file, &pt, returned)
                .text,
        )
    }

    /// `addPropertyToElementList`: the `enclosingDeclaration` that the name of `prop` is made with, which is
    /// `value_declaration_of_property`.
    pub(super) fn enclosing_declaration_of_property_name(
        &mut self,
        prop: &Prop,
    ) -> Option<Enclosing> {
        let (file, declaration) = self.value_declaration_of_property(prop, 0)?;
        let scope = match declaration {
            SyntaxNode::Member(member) => self.c.enclosing_scope_of_member(file, member),
            SyntaxNode::Prop(written) => self.c.enclosing_scope_of_property(file, written),
            SyntaxNode::Param(parameter) => {
                let pat = self.c.hir(file)[parameter].pat;
                self.c.enclosing_scope_of_pat(file, pat)
            }
            SyntaxNode::Expr(assignment) => self.c.enclosing_scope_of_expr(file, assignment),
            _ => return None,
        };
        Some(Enclosing::at_scope(file, scope))
    }

    /// `symbol.ValueDeclaration`, or else the first of `symbol.Declarations`.
    fn value_declaration_of_property(
        &mut self,
        prop: &Prop,
        depth: u32,
    ) -> Option<(FileId, SyntaxNode)> {
        match &prop.source {
            PropSource::Members(list) => {
                let &(file, member) = list.first()?;
                Some((file, SyntaxNode::Member(member)))
            }
            PropSource::Parameter(file, parameter) => Some((*file, SyntaxNode::Param(*parameter))),
            PropSource::Literal(file, written) => {
                // A JSX attribute has no inferred type.
                let owner = self.c.bound(*file).prop_owner[written.idx()];
                let is_in_object_literal =
                    owner.is_some() && matches!(self.c.hir(*file)[owner].kind, ExprKind::Object(_));
                is_in_object_literal.then_some((*file, SyntaxNode::Prop(*written)))
            }
            // Of assignments the first that is annotated says what the type is.
            PropSource::Assigned(file, list) => {
                let hir = self.c.hir(*file);
                let annotated = list
                    .iter()
                    .find(|&&e| hir.jsdoc_type(JsDocTypeOwner::Assign(e)).is_some());
                let &declaration = annotated.or(list.first())?;
                Some((*file, SyntaxNode::Expr(declaration)))
            }
            PropSource::Mapped(of, _) if depth < 8 => {
                let origin = self.c.synthetic_origin_of_mapped_property(*of, prop.name)?;
                self.value_declaration_of_property(&origin, depth + 1)
            }
            PropSource::Copy(_, of, _) if depth < 8 => {
                self.value_declaration_of_property(of.first()?, depth + 1)
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

    /// `serializeTypeForDeclaration`, of the declaration `node` of `file`, whose type is `ty` here. `is_unwidened`: if
    /// `ty` is the type of an array literal it still says so (`ObjectFlagsArrayLiteral`), which types do not keep.
    /// `is_optional_reverse_mapped`: the symbol is an optional property of a reverse mapped type.
    pub(super) fn serialize_type_for_declaration(
        &mut self,
        file: FileId,
        node: SyntaxNode,
        ty: TypeId,
        try_reuse: bool,
        is_unwidened: bool,
        is_optional_reverse_mapped: bool,
    ) -> Node {
        let hir = self.c.hir(file);
        // `requiresAddingImplicitUndefined`
        let requires_undefined = match node {
            SyntaxNode::Param(p) => {
                let in_function = self
                    .enclosing_declaration
                    .is_some_and(|at| self.c.is_function_like_declaration(at));
                self.c.iso_requires_implicit_undefined(file, p, in_function)
            }
            SyntaxNode::Member(m) => {
                is_optional_reverse_mapped
                    && hir[m].kind == MemberKind::Property
                    && hir[m].flags.contains(Flags::OPTIONAL)
                    && self.contains_non_missing_undefined_type(ty)
            }
            _ => false,
        };
        // `addUndefinedForParameter`
        let ty = if requires_undefined && matches!(node, SyntaxNode::Param(_)) {
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
    fn is_unique_symbol_of_declaration(&self, file: FileId, node: SyntaxNode, ty: TypeId) -> bool {
        let TypeData::UniqueSymbol { symbol, .. } = *self.c.data(ty) else {
            return false;
        };
        let own = match node {
            SyntaxNode::Var(d) => {
                let variable = self.c.bound(file).pat_symbol[self.c.hir(file)[d].pat.idx()];
                if variable.is_none() {
                    return false;
                }
                UniqueSymbolDeclaration::Variable(self.c.files().sym(file, variable))
            }
            SyntaxNode::Member(m) => UniqueSymbolDeclaration::Member(file, m),
            _ => return false,
        };
        own == symbol && self.enclosing_declaration.is_none_or(|at| at.file == file)
    }

    /// The rest of `serializeTypeForDeclaration`, under `tryReuse`.
    fn serialize_type_for_declaration_worker(
        &mut self,
        file: FileId,
        node: SyntaxNode,
        ty: TypeId,
        is_unwidened: bool,
        requires_undefined: bool,
    ) -> Node {
        let hir = self.c.hir(file);
        let accessor = self
            .c
            .iso_fn_of_node(file, node)
            .filter(|&f| matches!(hir[f].kind, FnKind::Getter | FnKind::Setter));
        let requires_widening = self.c.requires_widening(ty);
        if accessor.is_none() && (requires_widening || !self.c.iso_has_inferred_type(file, node)) {
            return self.type_to_node(ty);
        }
        let tx = Emit::without_reports(file);
        let pt = match accessor {
            Some(func) => self.c.iso_pseudo_of_accessor(&tx, func),
            None => self.c.iso_pseudo_of_declaration(&tx, node),
        };
        if is_unwidened && matches!(pt, Pseudo::Tuple(_)) {
            return self.type_to_node(ty);
        }
        // `isOptionalDeclaration`
        let has_question = match node {
            SyntaxNode::Param(p) => hir[p].flags.contains(Flags::OPTIONAL),
            SyntaxNode::Member(m) => {
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
        // What has been reported of an inferred type is not reported again of what the type is made of.
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
        let mut tx = Emit::without_reports(file);
        let is_equivalent =
            self.c
                .iso_is_equivalent(&mut tx, pt, ty, is_optional_annotated, report_errors);
        for node in tx.inference_fallbacks {
            self.report_inference_fallback(file, node);
        }
        is_equivalent
    }
}

// ───────────────────────────── types read off the syntax (`pseudotypenodebuilder.go`) ─────────────────────────────

impl<'p> Printer<'_, 'p> {
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
                if !self.can_reuse_existing_js_type_node(file, *existing, ty) =>
            {
                if !self.suppress_report_inference_fallback {
                    self.report_inference_fallback(file, SyntaxNode::Type(*existing));
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
                let tx = Emit::without_reports(file);
                for node in self.c.iso_error_nodes_of_inferred(&tx, *of, errors) {
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
            } => match self.c.iso_fn_of_node(file, *of) {
                Some(func) => self.inferred_return_type_to_node(file, func),
                None => Node::simple("any"),
            },
            Pseudo::Inferred { of, .. } => self.inferred_pseudo_type_to_node(file, *of),
            // Only the error type is equivalent to it.
            Pseudo::NoResult(_) => Node::simple("any"),
            Pseudo::MaybeConst {
                at,
                constant,
                regular,
            } => {
                if self.c.is_const_by_contextual_type(file, *at, true) {
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
                    // `appendTypeNode`: the members of a union among them are members of the whole.
                    let node = self.pseudo_type_to_node(file, member);
                    let nodes = if node.types.is_empty() {
                        vec![node]
                    } else {
                        let emitted = |text: String| Node::new(text, TYPE_OPERATOR);
                        node.types.into_iter().map(emitted).collect()
                    };
                    for node in nodes {
                        if node.text == "undefined" {
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
                    return Node::simple(if has_elided_type { "any" } else { "never" });
                }
                Node::union(parts)
            }
            Pseudo::Undefined => Node::simple(if is_strict { "undefined" } else { "any" }),
            Pseudo::Null => Node::simple(if is_strict { "null" } else { "any" }),
            Pseudo::String => Node::simple("string"),
            Pseudo::Number => Node::simple("number"),
            Pseudo::BigInt => Node::simple("bigint"),
            Pseudo::Boolean => Node::simple("boolean"),
            Pseudo::False => Node::simple("false"),
            Pseudo::True => Node::simple("true"),
            Pseudo::Signature {
                func,
                params,
                returns,
            } => {
                let outer_scope = self.enter_scope_of_function(file, *func);
                let head = self.pseudo_signature_head(file, *func, params);
                let returns = self.pseudo_type_to_node(file, returns);
                self.leave_scope(outer_scope);
                Node::new(format!("{head} => {}", returns.text), FUNCTION)
            }
            Pseudo::Tuple(elements) => {
                let mut parts = Vec::with_capacity(elements.len());
                for element in elements {
                    parts.push(self.pseudo_type_to_node(file, element).text);
                }
                Node::new(format!("readonly [{}]", parts.join(", ")), TYPE_OPERATOR)
            }
            Pseudo::Object(elements) => self.pseudo_object_literal_to_node(file, elements),
            Pseudo::Literal(e) => {
                let hir = self.c.hir(file);
                match hir[*e].kind {
                    ExprKind::String(value) => {
                        let quote = match hir.text.get(hir[*e].pos as usize) {
                            Some(b'\'') => '\'',
                            Some(b'`') => '`',
                            _ => '"',
                        };
                        self.string_literal_to_node(value, quote)
                    }
                    ExprKind::Template { texts, .. } if texts.len() == 1 => {
                        let mut text = String::from("`");
                        escape_string(&self.text(hir.id_at(texts, 0)), '`', false, &mut text);
                        text.push('`');
                        Node::simple(text)
                    }
                    // A number is written in its canonical form, as its type is.
                    _ => self.type_of_pseudo_type_to_node(file, pt),
                }
            }
        }
    }

    /// `serializeReturnTypeForSignature(getSignatureFromDeclaration(func), false)`
    fn inferred_return_type_to_node(&mut self, file: FileId, func: FnId) -> Node {
        let signature = self.c.sig_of_fn(file, func);
        let signature = self.c.instantiate_sig(signature, self.mapper);
        let declared = self.signature_parameters(signature);
        Node::new(
            self.return_type_text(signature, &declared, false),
            CONDITIONAL,
        )
    }

    /// `serializeTypeForDeclaration(declaration, nil, nil, false)`
    fn inferred_type_of_declaration_to_node(
        &mut self,
        file: FileId,
        declaration: SyntaxNode,
    ) -> Node {
        let Some(ty) = self.c.iso_type_of_declared(file, declaration) else {
            return Node::simple("any");
        };
        let ty = self.c.widen_literal(ty);
        let ty = self.c.instantiate(ty, self.mapper);
        self.serialize_type_for_declaration(file, declaration, ty, false, false, false)
    }

    /// `pseudoTypeToNode`, of a `PseudoTypeInferred` of the expression `of` that is not what a signature returns. The type is that of
    /// the declaration the expression is in, which is widened as that is and not as what is around it.
    fn inferred_pseudo_type_to_node(&mut self, file: FileId, of: SyntaxNode) -> Node {
        let (SyntaxNode::Expr(e) | SyntaxNode::Written(e)) = of else {
            return Node::simple("any");
        };
        let tx = Emit::without_reports(file);
        let (parent, declaration) = self.c.iso_parent_of_inferred(&tx, of);
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        let returned_by = match parent {
            Some(SyntaxNode::Stmt(s)) if matches!(hir[s].kind, StmtKind::Return(_)) => {
                self.c.enclosing_fn_of_expr(file, e)
            }
            // The body of an arrow function.
            Some(SyntaxNode::Expr(_)) => match bound.expr_parent[e.idx()] {
                Parent::FnBody(func) => Some(func),
                _ => None,
            },
            _ => None,
        };
        match (returned_by, declaration) {
            (Some(func), _) if matches!(hir[func].kind, FnKind::Getter | FnKind::Setter) => {
                let accessor = self.c.iso_node_of_fn(file, func);
                self.inferred_type_of_declaration_to_node(file, accessor)
            }
            (Some(func), _) => self.inferred_return_type_to_node(file, func),
            (None, Some(declaration)) => {
                self.inferred_type_of_declaration_to_node(file, declaration)
            }
            (None, None) => {
                let ty = self.c.type_of_expr(file, e);
                self.type_to_node(ty)
            }
        }
    }

    /// `typeToTypeNode(pseudoTypeToType(pt))`
    fn type_of_pseudo_type_to_node(&mut self, file: FileId, pt: &Pseudo) -> Node {
        match self.c.iso_type_of_pseudo(file, pt) {
            Some(ty) => {
                let ty = self.c.instantiate(ty, self.mapper);
                self.type_to_node(ty)
            }
            None => Node::simple("any"),
        }
    }

    /// A string literal that is cloned: it keeps its quotes, and its text is escaped anew.
    fn string_literal_to_node(&self, value: Atom, quote: char) -> Node {
        let bytes = self.c.files().atoms.bytes(value);
        if std::str::from_utf8(bytes).is_err() {
            return Node::simple(quoted_with_lone_surrogates(bytes, quote));
        }
        Node::simple(quoted(&self.text(value), quote, false))
    }

    /// The type parameters and `pseudoParametersToNodeList` of the function `func`.
    fn pseudo_signature_head(
        &mut self,
        file: FileId,
        func: FnId,
        params: &[PseudoParam],
    ) -> String {
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
        let mut parameters = Vec::with_capacity(params.len() + 1);
        if function.this_ty(self.c.hir(file)).is_some() {
            let this = self.reuse_type_node(file, function.this_ty(self.c.hir(file)));
            parameters.push(format!("this: {}", this.text));
        }
        for param in params {
            parameters.push(self.pseudo_parameter_to_text(file, param));
        }
        let type_parameters = if type_parameters.is_empty() {
            String::new()
        } else {
            format!("<{}>", type_parameters.join(", "))
        };
        format!("{type_parameters}({})", parameters.join(", "))
    }

    /// `pseudoParameterToNode`
    fn pseudo_parameter_to_text(&mut self, file: FileId, param: &PseudoParam) -> String {
        let declaration = self.c.hir(file)[param.param];
        let ty = self.pseudo_type_to_node(file, &param.ty);
        format!(
            "{}{}{}: {}",
            if declaration.flags.contains(Flags::REST) {
                "..."
            } else {
                ""
            },
            self.binding_name_text(file, declaration.pat),
            if param.is_optional { "?" } else { "" },
            ty.text
        )
    }

    /// `reuseName`, of the name of the property `p` of an object literal.
    fn pseudo_property_name(&self, file: FileId, p: PropId, is_method: bool) -> String {
        let hir = self.c.hir(file);
        let prop = hir[p];
        let PropKey::Name(name) = prop.key else {
            return self.property_key_text(file, prop.key, prop.pos);
        };
        let first = hir.text.get(prop.pos as usize).copied();
        let is_numeric = self.c.is_numeric_name(name);
        let name = self.text(name);
        // `classifyPropertyName`
        let is_new_method = is_method && name == "new";
        if !is_new_method && is_identifier_text(&name) {
            return name;
        }
        let is_string_literal = matches!(first, Some(b'"' | b'\''));
        if !is_new_method && !is_string_literal && is_numeric && !name.starts_with('-') {
            return if first == Some(b'[') {
                format!("[{name}]")
            } else {
                name
            };
        }
        quoted(&name, if first == Some(b'\'') { '\'' } else { '"' }, false)
    }

    /// `pseudoTypeToNode`, of `PseudoTypeKindObjectLiteral`
    fn pseudo_object_literal_to_node(&mut self, file: FileId, elements: &[PseudoElement]) -> Node {
        let Some(first) = elements.first() else {
            return Node::simple("{}");
        };
        let hir = self.c.hir(file);
        let literal = self.c.bound(file).prop_owner[first.prop.idx()];
        let is_const = literal.is_some() && self.c.is_const_by_contextual_type(file, literal, true);
        let saved_flags = self.flags;
        self.flags |= IN_OBJECT_TYPE_LITERAL;
        let mut members = Vec::with_capacity(elements.len());
        for element in elements {
            let readonly = if is_const { "readonly " } else { "" };
            members.push(match &element.kind {
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
                        format!("readonly {name}: {head} => {};", returns.text)
                    } else {
                        format!("{name}{head}: {};", returns.text)
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
                        "readonly "
                    } else {
                        readonly
                    };
                    let name = self.pseudo_property_name(file, element.prop, false);
                    let ty = self.pseudo_type_to_node(file, ty);
                    format!("{readonly}{name}: {};", ty.text)
                }
                PseudoElementKind::Setter { param, .. } => {
                    let name = self.pseudo_property_name(file, element.prop, false);
                    let parameter = self.pseudo_parameter_to_text(file, param);
                    format!("set {name}({parameter});")
                }
                PseudoElementKind::Getter { ty, .. } => {
                    let name = self.pseudo_property_name(file, element.prop, false);
                    let ty = self.pseudo_type_to_node(file, ty);
                    format!("get {name}(): {};", ty.text)
                }
            });
        }
        self.flags = saved_flags;
        Node::simple(format!("{{ {} }}", members.join(" ")))
    }
}

// ───────────────────────────── type nodes that are written again (`nodecopy.go`) ─────────────────────────────

/// `emitPostfixTypeOperand`, of the operand of a postfix type that is a parse tree node, as a reused one is (`updateNode` keeps the
/// flags): a type query gets no parentheses.
fn emit_postfix_type_operand(operand: Node) -> String {
    if operand.precedence == TYPE_OPERATOR && operand.text.starts_with("typeof ") {
        operand.text
    } else {
        operand.emit(POSTFIX)
    }
}

impl<'p> Printer<'_, 'p> {
    /// `tryReuseExistingNodeHelper`, but for the length. `visit`: the visitor, at the node.
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

    /// `reuseTypeNode`
    pub(super) fn reuse_type_node(&mut self, file: FileId, node: TypeNodeId) -> Node {
        if node.is_none() {
            return Node::simple("any");
        }
        // `finalizeBoundary`, `tryReuseExistingNodeHelper`: what counts is how long the node is in the source, with the space before
        // it. The text of the default library is not kept.
        let length_before = self.approximate_length;
        let reused = self.try_reuse_existing_node_helper(|printer| {
            printer.visit_existing_type_node(file, node, 0)
        });
        self.approximate_length = length_before;
        match reused {
            Some(reused) => {
                let length = if self.c.hir(file).text.is_empty() {
                    reused.text.len()
                } else {
                    let start = self.c.hir(file)[node].pos;
                    self.c.end_of_type_node(file, node).saturating_sub(start) as usize
                };
                self.approximate_length += length + 1;
                reused
            }
            None => {
                self.report_inference_fallback(file, SyntaxNode::Type(node));
                self.resolved_type_node_to_node(file, node)
            }
        }
    }

    /// The visitor of `getExistingNodeTreeVisitor`, at a type node. What cannot be written again is written from its type, but for a
    /// type predicate: `None`. `floor`: the parentheses that open before it are around what `node` is the first part of.
    fn visit_existing_type_node(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        floor: u32,
    ) -> Option<Node> {
        // After an error in a sibling whatever comes of it is dropped.
        if self.had_error() {
            return None;
        }
        if node.is_none() {
            return Some(Node::simple("any"));
        }
        if self.depth >= MAXIMUM_DEPTH || self.c.is_stack_low() {
            return Some(self.elided_information_placeholder());
        }
        self.depth += 1;
        let recovery_scope = self.start_recovery_scope();
        let visited = self.visit_existing_type_node_worker(file, node);
        self.depth -= 1;
        let hir = self.c.hir(file);
        let mut visited = match visited {
            Some(visited) if !self.had_error() => visited,
            _ if matches!(hir[node].kind, TypeNodeKind::Predicate { .. }) => {
                self.mark_error();
                return None;
            }
            _ => {
                self.end_recovery_scope(recovery_scope);
                let serialized = self.resolved_type_node_to_node(file, node);
                // What is reported of the type is an error of the node around this one.
                if self.had_error() {
                    return None;
                }
                serialized
            }
        };
        for _ in 0..self.c.parenthesized_type_depth(file, node, floor) {
            visited = Node::simple(format!("({})", visited.text));
        }
        Some(visited)
    }

    /// `getModuleSpecifierOverride`, of the import type `node` of `file`. `None`: the literal stays.
    fn get_module_specifier_override(&mut self, file: FileId, node: TypeNodeId) -> Option<String> {
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
        for part in hir.ids(name) {
            resolved = resolved
                .and_then(|container| files.resolve_alias(container))
                .and_then(|container| files.namespace_member(container, part));
        }
        let resolved = resolved.and_then(|symbol| files.resolve_alias(symbol));
        let meaning = if is_typeof {
            SymFlags::VALUE
        } else {
            SymFlags::TYPE
        };
        let parent = match resolved {
            Some(symbol) if self.c.is_symbol_accessible_at(symbol, meaning, false, at) => {
                self.track_symbol(symbol, meaning);
                let (starts_with_global_this, chain) =
                    self.c.lookup_symbol_chain_at(symbol, is_typeof, true, at);
                (!starts_with_global_this).then(|| chain[0])
            }
            _ => None,
        };
        // Otherwise `getExternalModuleFileFromDeclaration`.
        let module = parent
            .filter(|&parent| self.is_external_module(parent))
            .unwrap_or(target);
        let name = self.c.specifier_for_module_symbol_at(module, at);
        if name.contains("/node_modules/") {
            self.encountered_error = true;
            self.report(Report::LikelyUnsafeImportRequired(
                name.clone(),
                String::new(),
            ));
        }
        (!name.is_empty() && name != self.text(spec)).then_some(name)
    }

    /// `visitExistingNodeTreeSymbolsWorker`, and how the printer writes what comes of it.
    fn visit_existing_type_node_worker(&mut self, file: FileId, node: TypeNodeId) -> Option<Node> {
        let hir = self.c.hir(file);
        let pos = hir[node].pos;
        Some(match hir[node].kind {
            TypeNodeKind::Error | TypeNodeKind::Heritage(_) => return None,
            TypeNodeKind::Keyword(keyword) => Node::simple(match keyword {
                Keyword::Any => "any",
                Keyword::Unknown => "unknown",
                Keyword::Never => "never",
                Keyword::Void => "void",
                Keyword::Undefined => "undefined",
                Keyword::Null => "null",
                Keyword::String => "string",
                Keyword::Number => "number",
                Keyword::Boolean => "boolean",
                Keyword::BigInt => "bigint",
                Keyword::Symbol => "symbol",
                Keyword::Object => "object",
                Keyword::This => "this",
                Keyword::Intrinsic => "intrinsic",
            }),
            TypeNodeKind::Ref { .. } => return self.try_visit_type_reference(file, node),
            TypeNodeKind::Typeof { .. } => return self.try_visit_type_query(file, node),
            TypeNodeKind::IndexedAccess { .. } => return self.try_visit_indexed_access(file, node),
            TypeNodeKind::Keyof(_) => return self.try_visit_key_of(file, node),
            TypeNodeKind::Import {
                spec,
                name,
                args,
                is_typeof,
                mode,
            } => {
                let declared = self.c.type_from_node(file, node);
                // `IsLiteralImportTypeNode`
                if spec.is_none()
                    || mode != ResolutionMode::None
                    || self.c.instantiate(declared, self.mapper) != declared
                {
                    return None;
                }
                // `rewriteModuleSpecifier`
                let specifier = match self.get_module_specifier_override(file, node) {
                    Some(name) => quoted(&name, '"', true),
                    None => {
                        let is_quote = |&&byte: &&u8| byte == b'\'' || byte == b'"';
                        let quote = match hir.text.get(pos as usize..) {
                            Some(rest) if rest.iter().find(is_quote) == Some(&b'\'') => '\'',
                            _ => '"',
                        };
                        self.string_literal_to_node(spec, quote).text
                    }
                };
                let query = if is_typeof { "typeof " } else { "" };
                let mut text = format!("{query}import({specifier})");
                for part in hir.ids(name) {
                    text.push('.');
                    text.push_str(&self.text(part));
                }
                let arguments = self.visit_existing_type_nodes(file, args, 0)?;
                text.push_str(&type_arguments_text(arguments));
                Node::simple(text)
            }
            // Out of the scope it is written in it is written from its type, which reads the same.
            TypeNodeKind::UniqueSymbol => Node::new("unique symbol", TYPE_OPERATOR),
            TypeNodeKind::StringLit(value) => {
                let quote = match hir.text.get(pos as usize) {
                    Some(b'\'') => '\'',
                    _ => '"',
                };
                self.string_literal_to_node(value, quote)
            }
            TypeNodeKind::NumberLit(index) => Node::simple(crate::atom::number_to_string(
                hir.numbers.get(index as usize).copied().unwrap_or(0.0),
            )),
            TypeNodeKind::BigIntLit { text, negative } => {
                let digits = self.text(text);
                let digits = digits.strip_suffix('n').unwrap_or(&digits);
                let sign = if negative { "-" } else { "" };
                Node::simple(format!("{sign}{digits}n"))
            }
            TypeNodeKind::BoolLit(value) => Node::simple(if value { "true" } else { "false" }),
            TypeNodeKind::Template { types, texts } => {
                let mut text = String::from("`");
                for (i, piece) in hir.ids(texts).enumerate() {
                    escape_string(&self.text(piece), '`', false, &mut text);
                    if i < types.len() {
                        let ty = self.visit_existing_type_node(file, hir.id_at(types, i), 0)?;
                        text.push_str("${");
                        text.push_str(&ty.text);
                        text.push('}');
                    }
                }
                text.push('`');
                Node::simple(text)
            }
            TypeNodeKind::Array(element) => {
                let element = self.visit_existing_type_node(file, element, pos)?;
                Node::new(format!("{}[]", emit_postfix_type_operand(element)), POSTFIX)
            }
            TypeNodeKind::Readonly(of) => {
                let of = self.visit_existing_type_node(file, of, 0)?;
                Node::new(format!("readonly {}", of.emit(POSTFIX)), TYPE_OPERATOR)
            }
            TypeNodeKind::Tuple(elems) => {
                let mut parts = Vec::with_capacity(elems.len());
                for e in elems.iter() {
                    let elem = hir[e];
                    let ty = self.visit_existing_type_node(file, elem.ty, 0)?;
                    let dots = if elem.rest { "..." } else { "" };
                    parts.push(if elem.name.is_some() {
                        let question = if elem.optional { "?" } else { "" };
                        format!("{dots}{}{question}: {}", self.text(elem.name), ty.text)
                    } else if elem.optional {
                        format!("{}?", emit_postfix_type_operand(ty))
                    } else {
                        format!("{dots}{}", ty.text)
                    });
                }
                Node::simple(format!("[{}]", parts.join(", ")))
            }
            TypeNodeKind::Union(list) => {
                let nodes = self.visit_existing_type_nodes(file, list, pos)?;
                Node::union(nodes)
            }
            TypeNodeKind::Intersection(list) => {
                let nodes = self.visit_existing_type_nodes(file, list, pos)?;
                Node::new(join_nodes(nodes, " & ", TYPE_OPERATOR), INTERSECTION)
            }
            TypeNodeKind::Fn(f) => {
                let outer_scope = self.enter_scope_of_function(file, f);
                let head = self.visit_signature_head(file, f);
                let returned = self.visit_existing_type_node(file, hir[f].ret, 0);
                self.leave_scope(outer_scope);
                let (head, returned) = (head?, returned?);
                let keywords = match hir[f].kind {
                    FnKind::ConstructorType if hir[f].flags.contains(Flags::ABSTRACT) => {
                        "abstract new "
                    }
                    FnKind::ConstructorType => "new ",
                    _ => "",
                };
                Node::new(format!("{keywords}{head} => {}", returned.text), FUNCTION)
            }
            TypeNodeKind::Object(members) => {
                let scope = self.c.bound(file).type_scope[node.idx()];
                let mut elements = Vec::with_capacity(members.len());
                for m in members.iter() {
                    let outer_scope = hir[m]
                        .func
                        .some()
                        .map(|f| self.enter_scope_of_function(file, f));
                    let element = self.visit_type_element(file, m, scope);
                    if let Some(outer_scope) = outer_scope {
                        self.leave_scope(outer_scope);
                    }
                    elements.push(element?);
                }
                if elements.is_empty() {
                    Node::simple("{}")
                } else {
                    Node::simple(format!("{{ {} }}", elements.join(" ")))
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
                    format!(
                        "{} extends {} ? {} : {}",
                        check.emit(UNION),
                        extends.emit(FUNCTION),
                        yes.text,
                        no.text
                    ),
                    CONDITIONAL,
                )
            }
            TypeNodeKind::Infer(tp) => {
                let parameter = self.c.declared_type_of_type_parameter(file, tp);
                let name = self.type_parameter_to_name(parameter);
                if hir[tp].constraint.is_none() {
                    Node::new(format!("infer {name}"), TYPE_OPERATOR)
                } else {
                    let constraint = self.visit_existing_type_node(file, hir[tp].constraint, 0)?;
                    Node::new(
                        format!("infer {name} extends {}", constraint.emit(FUNCTION)),
                        FUNCTION,
                    )
                }
            }
            TypeNodeKind::Mapped(m) => {
                let mapped = hir[m];
                let key = self.c.type_param(file, mapped.param);
                let outer_scope = self.enter_new_scope(&[], &[key], None, false);
                let name = self.type_parameter_to_name(key);
                let constraint =
                    self.visit_existing_type_node(file, hir[mapped.param].constraint, 0);
                let name_type = self.visit_existing_type_node(file, mapped.name_ty, 0);
                let template = self.visit_existing_type_node(file, mapped.ty, 0);
                self.leave_scope(outer_scope);
                let (constraint, name_type, template) = (constraint?, name_type?, template?);
                let renamed = if mapped.name_ty.is_some() {
                    format!(" as {}", name_type.text)
                } else {
                    String::new()
                };
                let readonly = match mapped.readonly {
                    MappedModifier::None => "",
                    MappedModifier::Add => "readonly ",
                    MappedModifier::Remove => "-readonly ",
                };
                let question = match mapped.optional {
                    MappedModifier::None => "",
                    MappedModifier::Add => "?",
                    MappedModifier::Remove => "-?",
                };
                Node::simple(format!(
                    "{{ {readonly}[{name} in {}{renamed}]{question}: {}; }}",
                    constraint.text, template.text
                ))
            }
            TypeNodeKind::Predicate { param, ty, asserts } => {
                let mut text = String::new();
                if asserts {
                    text.push_str("asserts ");
                }
                text.push_str(&self.text(param));
                if ty.is_some() {
                    let ty = self.visit_existing_type_node(file, ty, 0)?;
                    text.push_str(" is ");
                    text.push_str(&ty.text);
                }
                Node::simple(text)
            }
        })
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
            nodes.push(self.visit_existing_type_node(file, node, floor)?);
        }
        Some(nodes)
    }

    /// `enterNewScope`, of the function-like `f`. What it returns is for `leave_scope`.
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
    fn visit_type_parameter_declaration(
        &mut self,
        file: FileId,
        tp: TypeParamId,
    ) -> Option<String> {
        let declaration = self.c.hir(file)[tp];
        let mut text = String::new();
        for (flag, modifier) in [
            (Flags::CONST, "const "),
            (Flags::IN, "in "),
            (Flags::OUT, "out "),
        ] {
            if declaration.flags.contains(flag) {
                text.push_str(modifier);
            }
        }
        let parameter = self.c.declared_type_of_type_parameter(file, tp);
        text.push_str(&self.type_parameter_to_name(parameter));
        if declaration.constraint.is_some() {
            let constraint = self.visit_existing_type_node(file, declaration.constraint, 0)?;
            text.push_str(" extends ");
            text.push_str(&constraint.text);
        }
        if declaration.default.is_some() {
            let default = self.visit_existing_type_node(file, declaration.default, 0)?;
            text.push_str(" = ");
            text.push_str(&default.text);
        }
        Some(text)
    }

    /// A `ParameterDeclaration`. Without a type it is `any`.
    fn visit_parameter_declaration(&mut self, file: FileId, p: ParamId) -> Option<String> {
        let parameter = self.c.hir(file)[p];
        let ty = self.visit_existing_type_node(file, parameter.ty, 0)?;
        Some(format!(
            "{}{}{}: {}",
            if parameter.flags.contains(Flags::REST) {
                "..."
            } else {
                ""
            },
            self.binding_name_text(file, parameter.pat),
            if parameter.flags.contains(Flags::OPTIONAL) {
                "?"
            } else {
                ""
            },
            ty.text
        ))
    }

    fn visit_parameter_declarations(&mut self, file: FileId, f: FnId) -> Option<String> {
        let function = self.c.hir(file)[f];
        let mut parameters = Vec::with_capacity(function.params.len() + 1);
        if function.this_ty(self.c.hir(file)).is_some() {
            let this =
                self.visit_existing_type_node(file, function.this_ty(self.c.hir(file)), 0)?;
            parameters.push(format!("this: {}", this.text));
        }
        for p in function.params.iter() {
            parameters.push(self.visit_parameter_declaration(file, p)?);
        }
        Some(parameters.join(", "))
    }

    /// The type parameters and the parameters of the function-like `f`.
    fn visit_signature_head(&mut self, file: FileId, f: FnId) -> Option<String> {
        let type_params = self.c.hir(file)[f].type_params;
        let mut type_parameters = Vec::with_capacity(type_params.len());
        for tp in type_params.iter() {
            type_parameters.push(self.visit_type_parameter_declaration(file, tp)?);
        }
        let parameters = self.visit_parameter_declarations(file, f)?;
        Some(if type_parameters.is_empty() {
            format!("({parameters})")
        } else {
            format!("<{}>({parameters})", type_parameters.join(", "))
        })
    }

    /// A member of a type literal. `None`: the type literal is written from its type.
    fn visit_type_element(&mut self, file: FileId, m: MemberId, scope: ScopeId) -> Option<String> {
        let hir = self.c.hir(file);
        let member = hir[m];
        let readonly = if member.flags.contains(Flags::READONLY) {
            "readonly "
        } else {
            ""
        };
        let question = if member.flags.contains(Flags::OPTIONAL) {
            "?"
        } else {
            ""
        };
        let name = match member.key {
            // A string keeps its quotes and is escaped anew, a number is written in its canonical form.
            PropKey::Name(name) => {
                let start = start_of_member_name(hir, m);
                match hir.text.get(start as usize) {
                    Some(b'\'') => quoted(&self.text(name), '\'', false),
                    Some(b'"') => quoted(&self.text(name), '"', false),
                    Some(b'[') => self.property_key_text(file, member.key, start),
                    _ if member.flags.contains(Flags::STRING_NAME) => {
                        quoted(&self.text(name), '"', false)
                    }
                    _ => self.text(name),
                }
            }
            PropKey::None => String::new(),
            PropKey::Computed(e) => {
                let name = self.entity_name_text(file, e)?;
                let first = first_identifier(hir, e);
                let ExprKind::Ident(first) = hir[first].kind else {
                    return None;
                };
                let node = SyntaxNode::Expr(e);
                if self.track_existing_entity_name(file, node, scope, first, SymFlags::VALUE) {
                    return None;
                }
                format!("[{name}]")
            }
            PropKey::Private(_) => {
                self.property_key_text(file, member.key, start_of_member_name(hir, m))
            }
        };
        let is_named = !name.is_empty();
        if member.func.is_none() && member.kind != MemberKind::Property {
            return None;
        }
        Some(match member.kind {
            MemberKind::Property if is_named => {
                let ty = self.visit_existing_type_node(file, member.ty, 0)?;
                format!("{readonly}{name}{question}: {};", ty.text)
            }
            MemberKind::Method if is_named => {
                let head = self.visit_signature_head(file, member.func)?;
                let returned = self.visit_existing_type_node(file, hir[member.func].ret, 0)?;
                format!("{name}{question}{head}: {};", returned.text)
            }
            MemberKind::CallSignature => {
                let head = self.visit_signature_head(file, member.func)?;
                let returned = self.visit_existing_type_node(file, hir[member.func].ret, 0)?;
                format!("{head}: {};", returned.text)
            }
            MemberKind::ConstructSignature => {
                let head = self.visit_signature_head(file, member.func)?;
                let returned = self.visit_existing_type_node(file, hir[member.func].ret, 0)?;
                format!("new {head}: {};", returned.text)
            }
            MemberKind::IndexSignature => {
                let parameters = self.visit_parameter_declarations(file, member.func)?;
                let value = self.visit_existing_type_node(file, hir[member.func].ret, 0)?;
                format!("{readonly}[{parameters}]: {};", value.text)
            }
            // An accessor is left without the type it does not say.
            MemberKind::Getter if is_named => {
                let returned = hir[member.func].ret;
                if returned.is_none() {
                    format!("get {name}();")
                } else {
                    let returned = self.visit_existing_type_node(file, returned, 0)?;
                    format!("get {name}(): {};", returned.text)
                }
            }
            MemberKind::Setter if is_named => {
                let parameters = self.visit_parameter_declarations(file, member.func)?;
                format!("set {name}({parameters});")
            }
            _ => return None,
        })
    }

    /// `tryVisitSimpleTypeNode`. `None`: neither `node` nor what it is the operand of can be written again.
    fn try_visit_simple_type_node(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        floor: u32,
    ) -> Option<Node> {
        // `SkipParentheses` skips no `ParenthesizedType`.
        if self.c.parenthesized_type_depth(file, node, floor) > 0 {
            return self.visit_existing_type_node(file, node, floor);
        }
        match self.c.hir(file)[node].kind {
            TypeNodeKind::Ref { .. } => self.try_visit_type_reference(file, node),
            TypeNodeKind::Typeof { .. } => self.try_visit_type_query(file, node),
            TypeNodeKind::IndexedAccess { .. } => self.try_visit_indexed_access(file, node),
            TypeNodeKind::Keyof(_) => self.try_visit_key_of(file, node),
            _ => self.visit_existing_type_node(file, node, floor),
        }
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
            format!("{}[{}]", emit_postfix_type_operand(object), index.text),
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
            format!("keyof {}", of.emit(TYPE_OPERATOR)),
            TYPE_OPERATOR,
        ))
    }

    /// `tryVisitTypeQuery`
    fn try_visit_type_query(&mut self, file: FileId, node: TypeNodeId) -> Option<Node> {
        let hir = self.c.hir(file);
        let TypeNodeKind::Typeof { name, args, .. } = hir[node].kind else {
            return None;
        };
        let names: Vec<Atom> = hir.ids(name).collect();
        let &first = names.first()?;
        let scope = self.c.bound(file).type_scope[node.idx()];
        let introduces_error = if first == known::this {
            // What is reported of it is dropped where the node is written from its type.
            if !self.is_this_container_accessible(file, node) {
                return None;
            }
            false
        } else {
            self.track_existing_entity_name(
                file,
                SyntaxNode::EntityName(node),
                scope,
                first,
                SymFlags::VALUE,
            )
        };
        let arguments = self.visit_existing_type_nodes(file, args, 0)?;
        if introduces_error {
            return self.serialize_type_name(file, scope, &names, true, arguments);
        }
        let path: Vec<String> = names.iter().map(|&name| self.text(name)).collect();
        Some(Node::new(
            format!(
                "typeof {}{}",
                path.join("."),
                type_arguments_text(arguments)
            ),
            TYPE_OPERATOR,
        ))
    }

    /// `trackExistingEntityName`, of the name after `typeof` in `query`, which starts with `this`: whether the symbol of
    /// `getThisContainer` is accessible where the name is written. A member has no symbol: it is as accessible as what it is a member
    /// of (`getContainersOfSymbol`).
    fn is_this_container_accessible(&mut self, file: FileId, query: TypeNodeId) -> bool {
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        let TypeNodeKind::Typeof { expr, .. } = hir[query].kind else {
            return false;
        };
        let scope = bound.type_scope[query.idx()];
        let this = first_identifier(hir, expr);
        let symbol = match self.c.this_container_of_type_query(file, this) {
            Some(QueriedThisContainer::Fn(f)) => match bound.fns[f.idx()].owner {
                FnOwner::Stmt(_) => bound.fn_symbol[f.idx()],
                FnOwner::Member(m) => match bound.member_owner[m.idx()] {
                    MemberOwner::Class(c) => bound.class_symbol[c.idx()],
                    MemberOwner::Interface(i) => bound.interface_symbol[i.idx()],
                    _ => SymbolId::NONE,
                },
                _ => SymbolId::NONE,
            },
            Some(QueriedThisContainer::Property) => {
                let mut around = scope;
                loop {
                    if around.is_none() {
                        break SymbolId::NONE;
                    }
                    if let ScopeKind::Class(c) = bound.scopes[around.idx()].kind {
                        break bound.class_symbol[c.idx()];
                    }
                    around = bound.scopes[around.idx()].parent;
                }
            }
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
        let names: Vec<Atom> = hir.ids(name).collect();
        let &first = names.first()?;
        if names.contains(&known::empty) {
            return Some(Node::simple("any"));
        }
        let scope = self.c.bound(file).type_scope[node.idx()];
        let declared = self.c.type_from_node(file, node);
        let is_type_parameter = files
            .resolve_entity(file, scope, &names, SymFlags::TYPE)
            .is_some_and(|symbol| files.flags(symbol).contains(SymFlags::TYPE_PARAMETER));
        // The type parameter of a class means nothing in a static member: that is a name nothing goes by.
        let variable = self.c.actual_type_variable(declared);
        if is_type_parameter && matches!(self.c.data(variable), TypeData::TypeParam(..)) {
            // One that the signature being written is instantiated for stands for something else.
            if self.c.instantiate(variable, self.mapper) != variable {
                return None;
            }
            let name = self.type_parameter_to_name(variable);
            return Some(Node {
                text: name.clone(),
                precedence: NON_ARRAY,
                reference: Some(name),
                types: Vec::new(),
            });
        }
        if !self.can_reuse_existing_js_type_node(file, node, declared) {
            return None;
        }
        let meaning = if names.len() == 1 {
            SymFlags::TYPE
        } else {
            SymFlags::NAMESPACE
        };
        let introduces_error = self.track_existing_entity_name(
            file,
            SyntaxNode::EntityName(node),
            scope,
            first,
            meaning,
        );
        let arguments = self.visit_existing_type_nodes(file, args, 0)?;
        if introduces_error {
            return self.serialize_type_name(file, scope, &names, false, arguments);
        }
        let path: Vec<String> = names.iter().map(|&name| self.text(name)).collect();
        Some(Node {
            text: format!("{}{}", path.join("."), type_arguments_text(arguments)),
            precedence: NON_ARRAY,
            reference: match &path[..] {
                [only] => Some(only.clone()),
                _ => None,
            },
            types: Vec::new(),
        })
    }

    /// `reuseNode`, of the computed property name `[name]` written in `file`, where `name` is an entity name expression. `None`: it
    /// does not mean the same, or cannot be used, where the type is wanted.
    pub(super) fn reuse_computed_property_name(
        &mut self,
        file: FileId,
        name: ExprId,
    ) -> Option<String> {
        let hir = self.c.hir(file);
        let first = first_identifier(hir, name);
        let ExprKind::Ident(first) = hir[first].kind else {
            return None;
        };
        let scope = self.c.enclosing_scope_of_expr(file, name);
        let node = SyntaxNode::Expr(name);
        self.try_reuse_existing_node_helper(|printer| {
            let introduces_error =
                printer.track_existing_entity_name(file, node, scope, first, SymFlags::VALUE);
            (!introduces_error).then_some(())
        })?;
        let text = format!("[{}]", self.entity_name_text(file, name)?);
        self.approximate_length += text.len();
        Some(text)
    }

    /// `trackExistingEntityName`, of the name `node` that starts with `first` and is written in `scope` of `file`: whether it does not
    /// mean the same, or cannot be used, where the type is wanted.
    fn track_existing_entity_name(
        &mut self,
        file: FileId,
        node: SyntaxNode,
        scope: ScopeId,
        first: Atom,
        meaning: SymFlags,
    ) -> bool {
        let files = self.c.files();
        let here = files.resolve_name(file, scope, first, meaning);
        // A type parameter is not looked up again.
        if here.is_some_and(|symbol| files.flags(symbol).contains(SymFlags::TYPE_PARAMETER)) {
            return false;
        }
        // `IsSymbolAccessible`: from nowhere everything is.
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
            None => files.resolve_name(at.file, at.scope, first, meaning),
        };
        let symbol = match (there, here) {
            (None, None) => return false,
            // `getSymbolIfSameReference`
            (Some(there), Some(here))
                if there == here
                    || files.export_symbol_of_value_symbol_if_exported(there)
                        == files.export_symbol_of_value_symbol_if_exported(here)
                    || files.resolve_alias(there) == files.resolve_alias(here) =>
            {
                there
            }
            (Some(there), None) => there,
            _ => {
                self.report_inference_fallback(file, node);
                return true;
            }
        };
        // A parameter that is found is visible.
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

    /// `serializeTypeName`, of the entity name `names` written in `scope` of `file`. `None`: what it means cannot be named where the
    /// type is wanted.
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
        let found = files.resolve_entity(file, scope, names, meaning)?;
        // `resolveEntityName`: an alias that has not the meaning itself is followed.
        let symbol = files.resolve_alias_as(found, meaning).unwrap_or(found);
        if !self.c.is_symbol_accessible_at(symbol, meaning, false, at) {
            return None;
        }
        let resolved = files.resolve_alias(symbol).unwrap_or(symbol);
        Some(self.symbol_to_type_node(resolved, is_type_of, type_arguments))
    }

    /// `canReuseExistingJSTypeNode`: not what stands for something else in a JSDoc comment, and not a reference to the target of `ty`
    /// with too few type arguments.
    fn can_reuse_existing_js_type_node(
        &mut self,
        file: FileId,
        existing: TypeNodeId,
        ty: TypeId,
    ) -> bool {
        let (hir, files) = (self.c.hir(file), self.c.files());
        let TypeNodeKind::Ref { name, args } = hir[existing].kind else {
            return true;
        };
        if self
            .c
            .intended_type_of_jsdoc_reference(file, existing)
            .is_some()
        {
            return false;
        }
        let target = match self.c.data(ty) {
            TypeData::Ref { target, .. } => *target,
            _ => return true,
        };
        let names: Vec<Atom> = hir.ids(name).collect();
        let scope = self.c.bound(file).type_scope[existing.idx()];
        let Some(found) = files.resolve_entity(file, scope, &names, SymFlags::TYPE) else {
            return true;
        };
        if files.resolve_alias(found) != Some(target) {
            return true;
        }
        let type_parameters = self.c.all_type_params_of_symbol(target);
        args.len() >= self.c.min_type_argument_count(&type_parameters)
    }
}

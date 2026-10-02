//! What the node builder does with a declared type where it has an enclosing declaration. The type is read off the syntax
//! (`pseudochecker`), held against what the checker says (`pseudoTypeEquivalentToType`) and, if the two agree, written as the source
//! writes it (`pseudotypenodebuilder.go`, `nodecopy.go`). The pseudochecker is the one `isolatedDeclarations` is checked with.

use super::super::errors_isolated_declarations::{
    Emit, Node as SyntaxNode, Pseudo, PseudoElement, PseudoElementKind, PseudoParam,
};
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
                    false,
                ),
            _ => self.type_to_node(parameter.ty),
        }
    }

    /// `tryGetThisParameterDeclaration`: the type `this` of the `this` parameter of `signature`.
    pub(super) fn serialize_type_of_this_parameter(
        &mut self,
        signature: SigId,
        this: TypeId,
    ) -> Node {
        if let Some((file, func, _)) = self.c.sig_decl(signature)
            && self.reuses_nodes_of(file)
        {
            let written = self.c.hir(file)[func].this_ty;
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
            return self.serialize_type_for_declaration(file, declaration, ty, is_unwidened);
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
        if self.enclosing_declaration.is_some()
            && let PropSource::Members(list) = &prop.source
            && let Some(&(file, member)) = list
                .iter()
                .find(|&&(file, member)| self.c.hir(file)[member].kind == kind)
            && self.reuses_nodes_of(file)
        {
            return self.serialize_type_for_declaration(
                file,
                SyntaxNode::Member(member),
                ty,
                false,
            );
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
        let mut tx = Emit::without_reports(file);
        let pt = self.c.iso_pseudo_of_return(&tx, func);
        // `pseudoTypeToNodeWithCheckerFallback` writes the type then, which the caller does, predicate and all.
        if matches!(pt, Pseudo::Inferred { .. } | Pseudo::NoResult(_)) {
            return None;
        }
        let returned = self.c.sig_return_for_inference(signature);
        // `getReturnTypeOfSignature`: an annotation that comes back to itself is given up for `anyType`, which is not what it says.
        if self.c.p.circular_returns.get(&(file, func)).is_some() {
            return None;
        }
        if !self
            .c
            .iso_is_equivalent(&mut tx, &pt, returned, false, false)
        {
            return None;
        }
        // The pseudochecker knows nothing of a predicate that is inferred.
        if let Some(predicate) = self.c.sig_predicate(signature)
            && !self
                .c
                .iso_matches_predicate(file, &pt, signature, predicate)
        {
            return None;
        }
        Some(
            self.pseudo_type_to_node_with_checker_fallback(file, &pt, returned)
                .text,
        )
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
                let origin = self.origin_of_mapped_property(*of, prop.name)?;
                self.value_declaration_of_property(&origin, depth + 1)
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

    /// `serializeTypeForDeclaration` with `tryReuse`, of the declaration `node` of `file`, whose type is `ty` here. `is_unwidened`: if
    /// `ty` is the type of an array literal it still says so (`ObjectFlagsArrayLiteral`), which types do not keep.
    fn serialize_type_for_declaration(
        &mut self,
        file: FileId,
        node: SyntaxNode,
        ty: TypeId,
        is_unwidened: bool,
    ) -> Node {
        let hir = self.c.hir(file);
        // The enclosing declaration is the scope made up for the signature, which is not function-like.
        let requires_undefined = match node {
            SyntaxNode::Param(p) => self.c.iso_requires_implicit_undefined(file, p, false),
            _ => false,
        };
        let ty = if requires_undefined {
            self.c.optional(ty)
        } else {
            ty
        };
        let accessor = self
            .c
            .iso_fn_of_node(file, node)
            .filter(|&f| matches!(hir[f].kind, FnKind::Getter | FnKind::Setter));
        // `ObjectFlagsRequiresWidening`
        let requires_widening = self
            .c
            .p
            .types
            .flags(ty)
            .contains(TypeFlags::HAS_OBJECT_LITERAL);
        if accessor.is_none() && (requires_widening || !self.c.iso_has_inferred_type(file, node)) {
            return self.type_to_node(ty);
        }
        let mut tx = Emit::without_reports(file);
        let pt = match accessor {
            Some(func) => self.c.iso_pseudo_of_accessor(&tx, func),
            None => self.c.iso_pseudo_of_declaration(&tx, node),
        };
        // Equivalent or not, the type is written (`pseudoTypeToNodeWithCheckerFallback`).
        if matches!(pt, Pseudo::Inferred { .. } | Pseudo::NoResult(_))
            || is_unwidened && matches!(pt, Pseudo::Tuple(_))
        {
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
        if self
            .c
            .iso_is_equivalent(&mut tx, &pt, ty, is_optional_annotated, false)
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
        let adds_undefined = requires_undefined
            && match self.c.iso_type_of_pseudo(file, &pt) {
                Some(from) => !self.contains_non_missing_undefined_type(from),
                None => !Checker::iso_could_be_undefined(hir, &pt),
            };
        if adds_undefined {
            let pt = Pseudo::Union(vec![pt, Pseudo::Undefined]);
            if self.c.iso_is_equivalent(&mut tx, &pt, ty, false, false) {
                return self.pseudo_type_to_node_with_checker_fallback(file, &pt, ty);
            }
        }
        self.type_to_node(ty)
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
            Pseudo::Inferred { .. } => self.type_to_node(ty),
            Pseudo::Direct(existing)
                if !self.can_reuse_existing_js_type_node(file, *existing, ty) =>
            {
                self.type_to_node(ty)
            }
            _ => self.pseudo_type_to_node(file, pt),
        }
    }

    /// `pseudoTypeToNode`
    fn pseudo_type_to_node(&mut self, file: FileId, pt: &Pseudo) -> Node {
        let is_strict = self.c.files().options.strict_null_checks;
        match pt {
            Pseudo::Direct(node) => self.reuse_type_node(file, *node),
            Pseudo::Inferred {
                of,
                is_signature_return: true,
                ..
            } => match self.c.iso_fn_of_node(file, *of) {
                Some(func) => {
                    let signature = self.c.sig_of_fn(file, func);
                    let declared = self.signature_parameters(signature);
                    Node::new(self.return_type_text(signature, &declared), CONDITIONAL)
                }
                None => Node::simple("any"),
            },
            // It has been found to be what the checker says, so that is what is written.
            Pseudo::Inferred { .. } => self.type_of_pseudo_type_to_node(file, pt),
            // Only the error type is equivalent to it.
            Pseudo::NoResult(_) => Node::simple("any"),
            Pseudo::MaybeConst {
                at,
                constant,
                regular,
            } => {
                if self.c.in_const_context(file, *at) {
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
                    let node = self.pseudo_type_to_node(file, member);
                    if node.text == "undefined" {
                        if has_undefined {
                            continue;
                        }
                        has_undefined = true;
                    }
                    parts.push(node);
                }
                if parts.len() == 1
                    && let Some(only) = parts.pop()
                {
                    return only;
                }
                if parts.is_empty() {
                    return Node::simple(if has_elided_type { "any" } else { "never" });
                }
                // The members of a union among them are members of the whole.
                let parts: Vec<String> = parts
                    .into_iter()
                    .map(|node| {
                        if node.precedence == UNION {
                            node.text
                        } else {
                            node.emit(TYPE_OPERATOR)
                        }
                    })
                    .collect();
                Node::new(parts.join(" | "), UNION)
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
            let declaration = match self.visit_type_parameter_declaration(file, tp) {
                Some(declaration) => declaration,
                None => self.type_parameter_name(file, tp),
            };
            type_parameters.push(declaration);
        }
        let mut parameters = Vec::with_capacity(params.len() + 1);
        if function.this_ty.is_some() {
            let this = self.reuse_type_node(file, function.this_ty);
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
        let is_const = literal.is_some() && self.c.in_const_context(file, literal);
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
    /// `reuseTypeNode`
    pub(super) fn reuse_type_node(&mut self, file: FileId, node: TypeNodeId) -> Node {
        if !self.reuses_nodes_of(file) {
            if self.depth >= MAXIMUM_DEPTH || self.c.is_stack_low() {
                return self.elided_information_placeholder();
            }
            self.depth += 1;
            let result = self.type_node_to_node_worker(file, node);
            self.depth -= 1;
            return result;
        }
        // `tryReuseExistingNodeHelper`: what counts is how long the node is.
        let length_before = self.approximate_length;
        let reused = self.visit_existing_type_node(file, node, 0);
        self.approximate_length = length_before;
        match reused {
            Some(reused) => {
                self.approximate_length += reused.text.len();
                reused
            }
            None => self.resolved_type_node_to_node(file, node),
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
        if node.is_none() {
            return Some(Node::simple("any"));
        }
        if self.depth >= MAXIMUM_DEPTH || self.c.is_stack_low() {
            return Some(self.elided_information_placeholder());
        }
        self.depth += 1;
        let visited = self.visit_existing_type_node_worker(file, node);
        self.depth -= 1;
        let hir = self.c.hir(file);
        let mut visited = match visited {
            Some(visited) => visited,
            None if matches!(hir[node].kind, TypeNodeKind::Predicate { .. }) => return None,
            None => self.resolved_type_node_to_node(file, node),
        };
        for _ in 0..self.c.parenthesized_type_depth(file, node, floor) {
            visited = Node::simple(format!("({})", visited.text));
        }
        Some(visited)
    }

    /// `visitExistingNodeTreeSymbolsWorker`, and how the printer writes what comes of it.
    fn visit_existing_type_node_worker(&mut self, file: FileId, node: TypeNodeId) -> Option<Node> {
        let hir = self.c.hir(file);
        let pos = hir[node].pos;
        Some(match hir[node].kind {
            TypeNodeKind::Error => return None,
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
            // What the module is called depends on where it is called that.
            TypeNodeKind::Import { .. } => return None,
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
                Node::new(join_nodes(nodes, " | ", TYPE_OPERATOR), UNION)
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
                let mut elements = Vec::with_capacity(members.len());
                for m in members.iter() {
                    let outer_scope = hir[m]
                        .func
                        .some()
                        .map(|f| self.enter_scope_of_function(file, f));
                    let element = self.visit_type_element(file, m);
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
                let outer_scope = self.enter_new_scope(&infer_type_parameters);
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
                let name = self.type_parameter_name(file, tp);
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
                let outer_scope = self.enter_new_scope(&[key]);
                let name = self.type_parameter_name(file, mapped.param);
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
    fn enter_scope_of_function(&mut self, file: FileId, f: FnId) -> (usize, usize, usize) {
        let type_parameters: Vec<TypeId> = self.c.hir(file)[f]
            .type_params
            .iter()
            .map(|tp| self.c.type_param(file, tp))
            .collect();
        self.enter_new_scope(&type_parameters)
    }

    /// `typeParameterToName`, of the type parameter `tp` declares.
    fn type_parameter_name(&mut self, file: FileId, tp: TypeParamId) -> String {
        let parameter = self.c.type_param(file, tp);
        self.type_parameter_reference_to_node(parameter).text
    }

    /// A type parameter by its name, in the `extends` clause that declares it too.
    fn type_parameter_reference_to_node(&mut self, parameter: TypeId) -> Node {
        let saved = std::mem::take(&mut self.infer_type_parameters);
        let node = self.type_to_node(parameter);
        self.infer_type_parameters = saved;
        node
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
        text.push_str(&self.type_parameter_name(file, tp));
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
        if function.this_ty.is_some() {
            let this = self.visit_existing_type_node(file, function.this_ty, 0)?;
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
    fn visit_type_element(&mut self, file: FileId, m: MemberId) -> Option<String> {
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
            // Whether the name can be written depends on what it means where the type is wanted.
            PropKey::Computed(_) | PropKey::Private(_) => return None,
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
        // The container of `this` cannot be named.
        if first == known::this {
            return None;
        }
        let scope = self.c.bound(file).type_scope[node.idx()];
        let introduces_error = self.track_existing_entity_name(file, scope, first, SymFlags::VALUE);
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
        if is_type_parameter {
            // One that the signature being written is instantiated for stands for something else.
            if !matches!(self.c.data(declared), TypeData::TypeParam(..))
                || self.c.instantiate(declared, self.mapper) != declared
            {
                return None;
            }
            return Some(self.type_parameter_reference_to_node(declared));
        }
        if !self.can_reuse_existing_js_type_node(file, node, declared) {
            return None;
        }
        let meaning = if names.len() == 1 {
            SymFlags::TYPE
        } else {
            SymFlags::NAMESPACE
        };
        let introduces_error = self.track_existing_entity_name(file, scope, first, meaning);
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
        })
    }

    /// `trackExistingEntityName`, of a name that starts with `first` and is written in `scope` of `file`: whether it does not mean the
    /// same, or cannot be used, where the type is wanted. A type parameter is not looked up again, and a parameter is in the scope
    /// made up for the signature.
    fn track_existing_entity_name(
        &mut self,
        file: FileId,
        scope: ScopeId,
        first: Atom,
        meaning: SymFlags,
    ) -> bool {
        let files = self.c.files();
        let is_local_to_signature = |symbol: Sym| {
            files
                .flags(symbol)
                .intersects(SymFlags::TYPE_PARAMETER | SymFlags::PARAMETER)
        };
        let here = files.resolve_name(file, scope, first, meaning);
        if here.is_some_and(is_local_to_signature) {
            return false;
        }
        let Some((enclosing_file, enclosing_scope)) = self.enclosing_declaration else {
            // What is global is in every scope.
            return here.is_some_and(|symbol| files.global(first, meaning) != Some(symbol));
        };
        let symbol = match (
            files.resolve_name(enclosing_file, enclosing_scope, first, meaning),
            here,
        ) {
            (None, Some(_)) => return true,
            (None, None) => return false,
            // `getSymbolIfSameReference`
            (Some(there), Some(here))
                if there != here
                    && files.export_symbol_of_value_symbol_if_exported(there)
                        != files.export_symbol_of_value_symbol_if_exported(here)
                    && files.resolve_alias(there) != files.resolve_alias(here) =>
            {
                return true;
            }
            (Some(there), _) => there,
        };
        !is_local_to_signature(symbol)
            && !self.c.is_symbol_accessible_at(
                symbol,
                meaning,
                true,
                enclosing_file,
                enclosing_scope,
            )
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
        let (enclosing_file, enclosing_scope) = self.enclosing_declaration?;
        let meaning = if is_type_of {
            SymFlags::VALUE
        } else {
            SymFlags::TYPE
        };
        let found = files.resolve_entity(file, scope, names, meaning)?;
        // `resolveEntityName`: an alias that has not the meaning itself is followed.
        let symbol = if files.flags(found).intersects(meaning) {
            found
        } else {
            files.resolve_alias(found).unwrap_or(found)
        };
        if !self
            .c
            .is_symbol_accessible_at(symbol, meaning, false, enclosing_file, enclosing_scope)
        {
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

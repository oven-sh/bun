use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::types::utils::{
    StaticallyNamed, TypeOrValueSpecifier, parse_type_or_value_specifiers, type_matches_some_specifier,
    value_matches_some_specifier,
};
use bun_lint::types::{
    CheckFlags, Literal as LiteralValue, NameOf, Signature, SymbolFlags, SyntaxKind, TsNode, TsSymbol, Type,
};
use rustc_hash::FxHashMap;
use std::borrow::Cow;

/// Disallow using code marked as `@deprecated`.
pub struct NoDeprecated {
    allow: Vec<TypeOrValueSpecifier>,
}

const DEPRECATED: Message = Message::new("deprecated", "`{{name}}` is deprecated.");
const DEPRECATED_WITH_REASON: Message = Message::new("deprecatedWithReason", "`{{name}}` is deprecated. {{reason}}");

/// An `Identifier`, a `JSXIdentifier`, a `PrivateIdentifier` or a `Super`.
#[derive(Copy, Clone)]
struct IdentifierLike<'a> {
    /// `services.esTreeNodeToTSNodeMap.get(node)`
    node: TsNode<'a>,
    span: Span,
    /// `getReportedNodeName(node)`
    name: &'a [u8],
    is_super: bool,
}

impl<'a> IdentifierLike<'a> {
    fn new(node: TsNode<'a>, span: Span, name: &'a [u8]) -> Self {
        IdentifierLike { node, span, name, is_super: false }
    }

    /// A name that is not a node here.
    fn of_ident(ident: Ident<'a>, file: &'a File<'a>) -> Self {
        IdentifierLike::new(file.type_checker().ts_node(ident), ident.span(), ident.bytes())
    }
}

impl<'a> StaticallyNamed<'a> for IdentifierLike<'a> {
    fn get_static_name(self) -> Option<&'a [u8]> {
        (!self.is_super).then(|| self.name.strip_prefix(b"#").unwrap_or(self.name))
    }
}

/// `getJsDocDeprecation` of what has been asked about in the file: the same few symbols are used over and over.
#[derive(Default)]
pub struct Deprecations<'a> {
    /// tsgolint has no reason for a variable, whose comment is at the statement.
    has_no_reasons_for_variables: bool,
    /// For tsgolint a member does not inherit the tag of what it implements or overrides.
    is_nothing_inherited: bool,
    of_symbols: FxHashMap<TsSymbol<'a>, Option<&'a [u8]>>,
    of_signatures: FxHashMap<Signature<'a>, Option<&'a [u8]>>,
}

impl<'a> Deprecations<'a> {
    /// `getJsDocDeprecation(symbol)`
    fn of_symbol(&mut self, symbol: Option<TsSymbol<'a>>) -> Option<&'a [u8]> {
        let symbol = symbol?;
        let has_no_reasons_for_variables = self.has_no_reasons_for_variables;
        let is_nothing_inherited = self.is_nothing_inherited;
        *self.of_symbols.entry(symbol).or_insert_with(|| {
            let reason = match is_nothing_inherited {
                true => symbol.declarations().find_map(TsNode::deprecation)?,
                false => symbol.deprecation()?,
            };
            let is_variable =
                || symbol.declarations().next().is_some_and(|it| it.kind() == SyntaxKind::VariableDeclaration);
            Some(if has_no_reasons_for_variables && is_variable() { &b""[..] } else { reason })
        })
    }

    /// `getJsDocDeprecation(signature)`
    fn of_signature(&mut self, signature: Option<Signature<'a>>) -> Option<&'a [u8]> {
        let signature = signature?;
        let is_nothing_inherited = self.is_nothing_inherited;
        *self.of_signatures.entry(signature).or_insert_with(|| match is_nothing_inherited {
            true => signature.declaration()?.deprecation(),
            false => signature.deprecation(),
        })
    }

    /// `searchForDeprecationInAliasesChain`: an alias on the way from an import to what it finally refers to can be deprecated:
    /// `export { /** @deprecated */ foo }`.
    fn search_in_aliases_chain(
        &mut self,
        symbol: Option<TsSymbol<'a>>,
        check_deprecations_of_aliased_symbol: bool,
    ) -> Option<&'a [u8]> {
        let mut symbol = symbol?;
        if !symbol.has_flags(SymbolFlags::ALIAS) {
            return match check_deprecations_of_aliased_symbol {
                true => self.of_symbol(Some(symbol)),
                false => None,
            };
        }
        let target_symbol = symbol.get_aliased_symbol();
        let mut seen = rustc_hash::FxHashSet::default();
        while symbol.has_flags(SymbolFlags::ALIAS) && seen.insert(symbol) {
            if let Some(reason) = self.of_symbol(Some(symbol)) {
                return Some(reason);
            }
            symbol.declarations().next()?;
            symbol = symbol.get_immediate_aliased_symbol()?;
            if check_deprecations_of_aliased_symbol && symbol == target_symbol {
                return self.of_symbol(Some(symbol));
            }
        }
        None
    }

    /// `getCallLikeDeprecation(node)`, where `call` is `node.parent`.
    fn of_call_like(&mut self, node: TsNode<'a>, call: TsNode<'a>) -> Option<&'a [u8]> {
        let symbol = node.get_symbol_at_location();
        let aliased_symbol = symbol.map(TsSymbol::skip_alias);
        let symbol_declaration_kind = aliased_symbol.and_then(|it| it.declarations().next()).map(|it| it.kind());
        // A function or a method has a declaration for each overload, and the tags of a symbol are those of all its declarations.
        // So it is the signature that tells. A property with the type of a function has the tag on its symbol.
        let has_overloads = matches!(
            symbol_declaration_kind,
            Some(SyntaxKind::MethodDeclaration | SyntaxKind::FunctionDeclaration | SyntaxKind::MethodSignature)
        );
        if let Some(reason) = self.search_in_aliases_chain(symbol, !has_overloads) {
            return Some(reason);
        }
        if let Some(reason) = self.of_signature(call.get_resolved_signature()) {
            return Some(reason);
        }
        match has_overloads {
            true => None,
            false => self.of_symbol(aliased_symbol),
        }
    }

    /// `getDeprecationReason(node)` of a `node` whose parent is a `Property`. `object_type`: of the `ObjectExpression` or the
    /// `ObjectPattern`.
    fn of_property(
        &mut self,
        node: TsNode<'a>,
        name: &[u8],
        object_type: impl FnOnce() -> Type<'a>,
    ) -> Option<&'a [u8]> {
        let property_symbol = node.get_symbol_at_location();
        if let Some(reason) = self.search_in_aliases_chain(property_symbol, true) {
            return Some(reason);
        }
        if let Some(reason) = self.of_symbol(object_type().get_property(name)) {
            return Some(reason);
        }
        if let Some(reason) = self.of_symbol(property_symbol) {
            return Some(reason);
        }
        let value_symbol = property_symbol?.value_declaration()?.get_shorthand_assignment_value_symbol();
        self.search_in_aliases_chain(value_symbol, true)
    }

    /// `getDeprecationReason(node)` of any other `node`.
    fn of_identifier(&mut self, node: TsNode<'a>) -> Option<&'a [u8]> {
        self.search_in_aliases_chain(node.get_symbol_at_location(), true)
    }

    /// `getDeprecationReason(node)` of an identifier that is `callee`, or is the property of the `MemberExpression` `callee`.
    fn of_expression(&mut self, node: TsNode<'a>, callee: Expr<'a>) -> Option<&'a [u8]> {
        match get_call_like_node(callee) {
            Some((callee, call)) => self.of_call_like(callee.ts_node(), call.ts_node()),
            None => self.of_identifier(node),
        }
    }
}

/// `getCallLikeNode`: what is called, with the call, if that is `callee` or a `MemberExpression` that `callee` is the property of.
fn get_call_like_node(mut callee: Expr<'_>) -> Option<(Expr<'_>, Expr<'_>)> {
    loop {
        // Its parent is a `ChainExpression`.
        if callee.is_chain_root() {
            return None;
        }
        let Node::Expr(parent) = callee.parent() else {
            return None;
        };
        match parent.kind() {
            ExprKind::Index { index, .. } if index == callee => callee = parent,
            ExprKind::Call(call) | ExprKind::New(call) | ExprKind::TaggedTemplate(call) => {
                return (call.callee() == callee).then_some((callee, parent));
            }
            _ => return None,
        }
    }
}

/// The `a = 1` of `[a = 1] = b`, `({ a = 1 } = b)` and `({ a = 1 })`.
fn is_assignment_pattern(assignment: Expr) -> bool {
    assignment.is_assignment_target()
        || matches!(assignment.parent(), Node::Prop(prop) if prop.kind() == PropKind::Shorthand)
}

/// `services.getContextualType(openingElement.name)`
// TODO(api): replace by types::`Expr::contextual_type` of the tag name
fn jsx_attributes_type<'a>(element: Expr<'a>, tag: Expr<'a>) -> Option<Type<'a>> {
    tag.contextual_type().or_else(|| Some(element.resolved_signature()?.parameters().first()?.get_type()))
}

/// Calls `then` with `String(n)`.
fn with_number_as_string<R>(n: f64, then: impl FnOnce(&[u8]) -> R) -> R {
    if n.fract() != 0.0 || !(0.0..1e15).contains(&n) {
        return then(&text::number_to_string(n));
    }
    let mut digits = [b'0'; 16];
    let (mut at, mut rest) = (digits.len(), n as u64);
    for digit in digits.iter_mut().rev() {
        *digit = b'0' + (rest % 10) as u8;
        (at, rest) = (at - 1, rest / 10);
        if rest == 0 {
            break;
        }
    }
    then(digits.get(at..).unwrap_or_default())
}

/// What tsgolint has of a reason: of `{@link a.b text}` the `text`.
fn without_names_of_links(reason: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(reason.len());
    let mut rest = reason;
    while let Some(at) = strings::index_of(rest, b"{@link") {
        let after = rest.get(at + b"{@link".len()..).unwrap_or_default();
        let after = after.strip_prefix(b"code").or_else(|| after.strip_prefix(b"plain")).unwrap_or(after);
        let Some(end) = strings::index_of_char_usize(after, b'}') else {
            break;
        };
        let inside = strings::trim_js_whitespace_start(after.get(..end).unwrap_or_default());
        let is_in_name = |c: &&u8| c.is_ascii_alphanumeric() || matches!(**c, b'_' | b'$' | b'.');
        let name_len = inside.iter().take_while(is_in_name).count();
        out.extend_from_slice(rest.get(..at).unwrap_or_default());
        out.extend_from_slice(strings::trim_js_whitespace_start(inside.get(name_len..).unwrap_or_default()));
        rest = after.get(end + 1..).unwrap_or_default();
    }
    out.extend_from_slice(rest);
    out
}

impl NoDeprecated {
    /// What `checkIdentifier` does once it has the reason.
    fn report<'a>(&self, node: IdentifierLike<'a>, reason: Option<&'a [u8]>, cx: &Cx<'a, Self>) {
        let Some(reason) = reason else {
            return;
        };
        if !self.allow.is_empty() {
            let ty = node.node.get_type_at_location();
            if type_matches_some_specifier(ty, &self.allow) || value_matches_some_specifier(node, &self.allow, ty) {
                return;
            }
        }
        Self::report_at(node.span, Cow::Borrowed(node.name), reason, cx);
    }

    fn report_at<'a>(at: Span, name: Cow<'a, [u8]>, reason: &'a [u8], cx: &Cx<'a, Self>) {
        let is_oxlint = cx.language().is_oxlint;
        let reason = match is_oxlint && strings::contains(reason, b"{@link") {
            true => Cow::Owned(without_names_of_links(reason)),
            false => Cow::Borrowed(reason),
        };
        // tsgolint trims it once it has seen that there is one.
        let trimmed = if is_oxlint { strings::trim_js_whitespace(&reason) } else { &reason[..] };
        match reason.is_empty() {
            true => cx.report(at, DEPRECATED).data("name", name),
            false => cx.report(at, DEPRECATED_WITH_REASON).data("name", name).data("reason", trimmed.to_vec()),
        };
    }

    /// For an identifier that nothing is special about.
    fn check_plain<'a>(&self, node: IdentifierLike<'a>, cx: &mut Cx<'a, Self>) {
        let reason = cx.state.of_identifier(node.node);
        self.report(node, reason, cx);
    }

    /// For an identifier that is bound, where upstream does not take it for a declaration. `span`: with the type annotation.
    fn check_binding<'a>(&self, pat: Pat<'a>, span: Span, cx: &mut Cx<'a, Self>) {
        if let Some(name) = pat.as_ident().filter(|name| !name.is("this")) {
            self.check_plain(IdentifierLike::new(pat.ts_node(), span, name.bytes()), cx);
        }
    }

    fn check_entity_name<'a>(&self, name: EntityName<'a>, cx: &mut Cx<'a, Self>) {
        for (part, node) in name.parts().zip(name.ts_nodes()) {
            self.check_plain(IdentifierLike::new(node, part.span(), part.bytes()), cx);
        }
    }

    fn check_identifier<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Ident(name) = e.kind() else {
            return;
        };
        let name = name.bytes();
        let mut node = e.ts_node();
        let reason = match e.parent() {
            // tsgolint takes for a declaration whatever name has an arrow function or a parameter for its parent:
            // what the function returns, and a default value.
            Node::Func(_) | Node::Param(_) if cx.language().is_oxlint && !e.is_parenthesized() => return,
            Node::Expr(parent) => {
                match parent.kind() {
                    // `checkMemberExpression` handles it.
                    ExprKind::Index { index, .. } if index == e => return,
                    // An element of an `ArrayPattern`.
                    ExprKind::Array(_) if parent.is_assignment_target() => return,
                    ExprKind::Assign { target, .. } if target == e && is_assignment_pattern(parent) => return,
                    // `check_jsx` handles it.
                    ExprKind::Jsx(jsx) if jsx.tag() == Some(e) || jsx.close_tag() == Some(e) => return,
                    _ => {}
                }
                cx.state.of_expression(node, e)
            }
            Node::Prop(prop)
                if prop.kind() != PropKind::Spread && !prop.is_jsx_attribute() && !prop.is_import_attribute() =>
            {
                let Node::Expr(object) = prop.parent() else {
                    return;
                };
                // Upstream takes for a declaration the value in a pattern and the key in an object, also where that is computed.
                if (prop.value() == Some(e)) == object.is_assignment_target() {
                    return;
                }
                if prop.kind() == PropKind::Shorthand {
                    node = NameOf(prop).ts_node();
                }
                cx.state.of_property(node, name, || object.ty())
            }
            // A computed key.
            Node::PatProp(prop) if prop.default() != Some(e) => {
                let Node::Pat(pattern) = prop.parent() else {
                    return;
                };
                cx.state.of_property(node, name, || pattern.ty())
            }
            // A computed key. Upstream knows nothing of abstract members.
            Node::Member(member)
                if !member.flags().contains(Flags::ABSTRACT)
                    && matches!(member.key().map(Key::kind), Some(KeyKind::Computed(key)) if key == e) =>
            {
                return;
            }
            Node::EnumMember(member) if member.init() != Some(e) => return,
            _ => cx.state.of_identifier(node),
        };
        self.report(IdentifierLike::new(node, e.span(), name), reason, cx);
    }

    /// The `property` of a `MemberExpression` that is not computed, the `right` of a `TSQualifiedName` in a `typeof` type, the
    /// `property` of a `JSXMemberExpression`.
    fn check_property<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Dot { name, .. } = e.kind() else {
            return;
        };
        let node = IdentifierLike::new(NameOf(e).ts_node(), name.span(), name.bytes());
        let reason = cx.state.of_expression(node.node, e);
        self.report(node, reason, cx);
    }

    fn check_super<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let node = IdentifierLike { node: e.ts_node(), span: e.span(), name: b"super", is_super: true };
        let reason = cx.state.of_expression(node.node, e);
        self.report(node, reason, cx);
    }

    /// `checkMemberExpression`
    fn check_member_expression<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Index { obj, index, .. } = node.kind() else {
            return;
        };
        let property_type = index.ty();
        if !property_type.is_literal() {
            return;
        }
        let object_type = obj.ty();
        // A `PseudoBigInt` is `[object Object]` as a string.
        let (property, value) = match property_type.value() {
            Some(value @ LiteralValue::String(name)) => (object_type.get_property(name), value),
            Some(value @ LiteralValue::Number(n)) => {
                (with_number_as_string(n, |name| object_type.get_property(name)), value)
            }
            _ => return,
        };
        let Some(reason) = cx.state.of_symbol(property) else {
            return;
        };
        if type_matches_some_specifier(object_type, &self.allow) {
            return;
        }
        let property_name = match value {
            LiteralValue::String(name) => Cow::Borrowed(name),
            LiteralValue::Number(n) => Cow::Owned(text::number_to_string(n)),
            LiteralValue::BigInt { .. } => return,
        };
        Self::report_at(index.span(), property_name, reason, cx);
    }

    /// The `JSXIdentifier`s that are the name of an opening element or of an attribute.
    fn check_jsx<'a>(&self, element: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Jsx(jsx) = element.kind() else {
            return;
        };
        let Some(tag) = jsx.tag() else {
            return;
        };
        // `a:b` is a `JSXNamespacedName`.
        let is_identifier = |name: Name| !strings::contains_char(name.bytes(), b':');
        if let ExprKind::Ident(name) | ExprKind::String(name) = tag.kind()
            && is_identifier(name)
        {
            let node = IdentifierLike::new(tag.ts_node(), tag.span(), name.bytes());
            let reason = cx.state.of_call_like(node.node, element.ts_node());
            self.report(node, reason, cx);
        }
        let mut contextual_type = None;
        for attribute in jsx.attrs() {
            let Some(key) = attribute.key() else {
                continue;
            };
            let KeyKind::Ident(name) = key.kind() else {
                continue;
            };
            if !is_identifier(name) {
                continue;
            }
            let Some(contextual_type) = *contextual_type.get_or_insert_with(|| jsx_attributes_type(element, tag)) else {
                return;
            };
            if let Some(reason) = cx.state.of_symbol(contextual_type.get_property(name.bytes())) {
                let node = IdentifierLike::new(NameOf(attribute).ts_node(), key.span(cx.file()), name.bytes());
                self.report(node, Some(reason), cx);
            }
        }
    }

    /// The keys of an `ObjectPattern` that is assigned to.
    fn check_object<'a>(&self, object: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Object(properties) = object.kind() else {
            return;
        };
        if properties.is_empty() {
            return;
        }
        if !object.is_assignment_target() {
            if cx.language().is_oxlint {
                self.check_object_literal_as_tsgolint(object, properties, cx);
            }
            return;
        }
        for property in properties {
            if let Some(key) = property.key()
                && let KeyKind::Ident(name) = key.kind()
            {
                let node = IdentifierLike::new(NameOf(property).ts_node(), key.span(cx.file()), name.bytes());
                let reason = cx.state.of_property(node.node, node.name, || object.ty());
                self.report(node, reason, cx);
            }
        }
    }

    /// tsgolint's `checkObjectLiteralPropertyDeprecation`: a property that gives a value to one that is deprecated in
    /// what is expected of the object.
    fn check_object_literal_as_tsgolint<'a>(
        &self,
        object: Expr<'a>,
        properties: List<'a, Prop<'a>>,
        cx: &mut Cx<'a, Self>,
    ) {
        let Some(expected) = object.ts_node().get_apparent_type_of_contextual_type() else {
            return;
        };
        for property in properties {
            let Some(key) = property.key() else {
                continue;
            };
            let name = match key.kind() {
                KeyKind::Ident(name)
                | KeyKind::String(name)
                | KeyKind::Number(name)
                | KeyKind::Private(name)
                | KeyKind::ComputedString(name)
                | KeyKind::ComputedNumber(name) => name.bytes(),
                KeyKind::Computed(e) => match e.ty().value() {
                    Some(LiteralValue::String(value)) => value,
                    _ => continue,
                },
            };
            // `checker.isDeprecatedSymbol`: of a union or an intersection all that have it have to be deprecated.
            let symbol = expected.get_property(name).filter(|it| {
                !it.check_flags().intersects(CheckFlags::SYNTHETIC)
                    || it.declarations().all(|declaration| declaration.deprecation().is_some())
            });
            let reason = cx.state.of_symbol(symbol);
            self.report(IdentifierLike::new(NameOf(property).ts_node(), key.span(cx.file()), name), reason, cx);
        }
    }
}

impl Rule for NoDeprecated {
    const META: Meta =
        Meta::typescript("no-deprecated", Kind::Problem).presets(Presets::STRICT_TYPE_CHECKED).requires_types();
    const ON: On = On::new()
        .exprs(&[
            ExprTag::Ident,
            ExprTag::Dot,
            ExprTag::Index,
            ExprTag::Super,
            ExprTag::PrivateIdentifier,
            ExprTag::Jsx,
            ExprTag::Object,
        ])
        .pats(&[PatTag::Object, PatTag::Array])
        .params()
        .types(&[TypeTag::Ref, TypeTag::Import, TypeTag::Predicate])
        .stmts(&[StmtTag::Try, StmtTag::ImportEquals, StmtTag::Module])
        .members()
        .export_specs();
    type State<'a> = Deprecations<'a>;

    fn new(options: &Options) -> Self {
        NoDeprecated {
            allow: parse_type_or_value_specifiers(options.object(0).array("allow")),
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Deprecations<'a>> {
        let is_oxlint = file.language().is_oxlint;
        Some(Deprecations {
            has_no_reasons_for_variables: is_oxlint,
            is_nothing_inherited: is_oxlint,
            ..Deprecations::default()
        })
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match e.tag() {
            ExprTag::Ident => self.check_identifier(e, cx),
            ExprTag::Dot => self.check_property(e, cx),
            ExprTag::Index => self.check_member_expression(e, cx),
            ExprTag::Super => self.check_super(e, cx),
            ExprTag::PrivateIdentifier => {
                if let ExprKind::PrivateIdentifier(name) = e.kind() {
                    self.check_plain(IdentifierLike::new(e.ts_node(), e.span(), name.bytes()), cx);
                }
            }
            ExprTag::Jsx => self.check_jsx(e, cx),
            ExprTag::Object => self.check_object(e, cx),
            _ => {}
        }
    }

    /// The keys of an `ObjectPattern` that declares, and the argument of a `RestElement` in a pattern.
    fn pat<'a>(&self, pattern: Pat<'a>, cx: &mut Cx<'a, Self>) {
        match pattern.kind() {
            PatKind::Object(properties) => {
                for property in properties {
                    if property.is_rest() {
                        self.check_binding(property.value(), property.value().span(), cx);
                        continue;
                    }
                    let Some(key) = property.key() else {
                        continue;
                    };
                    let KeyKind::Ident(name) = key.kind() else {
                        continue;
                    };
                    let element = property.ts_node();
                    let Some(node) = element.property_name().or_else(|| element.name()) else {
                        continue;
                    };
                    let node = IdentifierLike::new(node, key.span(cx.file()), name.bytes());
                    let reason = cx.state.of_property(node.node, node.name, || pattern.ty());
                    self.report(node, reason, cx);
                }
            }
            PatKind::Array(elements) => {
                for element in elements {
                    if element.is_rest()
                        && let Some(argument) = element.pat()
                    {
                        self.check_binding(argument, argument.span(), cx);
                    }
                }
            }
            _ => {}
        }
    }

    /// Upstream takes the parameters of some kinds of functions for declarations, and no `RestElement`.
    fn param<'a>(&self, param: Param<'a>, cx: &mut Cx<'a, Self>) {
        if param.is_rest() {
            self.check_binding(param.pat(), param.pat().span(), cx);
            return;
        }
        let is_in_type = param.func().is_some_and(|func| {
            matches!(
                func.kind(),
                FnKind::FunctionType
                    | FnKind::ConstructorType
                    | FnKind::CallSignature
                    | FnKind::ConstructSignature
                    | FnKind::IndexSignature
            )
        });
        if is_in_type && param.default().is_none() {
            self.check_binding(param.pat(), param.binding_span(), cx);
        }
    }

    fn ty<'a>(&self, ty: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        match ty.kind() {
            TypeKind::Ref { name, .. } | TypeKind::Import { name, .. } => self.check_entity_name(name, cx),
            TypeKind::Predicate { .. } => {
                if let Some(parameter_name) = ty.predicate_param().filter(|it| !it.name().is("this")) {
                    self.check_plain(IdentifierLike::of_ident(parameter_name, cx.file()), cx);
                }
            }
            _ => {}
        }
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        match statement.kind() {
            // The parameter of a `CatchClause`.
            StmtKind::Try { param: Some(param), .. } => self.check_binding(param.pat(), param.binding_span(), cx),
            StmtKind::ImportEquals(import) => {
                if let ImportEqualsTarget::Entity(name) = import.target() {
                    self.check_entity_name(name, cx);
                }
            }
            // The names of `namespace A.B {}` are in a `TSQualifiedName`.
            StmtKind::Module(module) if module.nested().is_some() => {
                let mut at = Some(module);
                while let Some(module) = at {
                    if let ModuleName::Ident(name) = module.name() {
                        self.check_plain(IdentifierLike::of_ident(name, cx.file()), cx);
                    }
                    at = module.nested();
                }
            }
            _ => {}
        }
    }

    /// Upstream does not take the key of an abstract member for a declaration.
    fn member<'a>(&self, member: Member<'a>, cx: &mut Cx<'a, Self>) {
        if member.flags().contains(Flags::ABSTRACT)
            && !cx.language().is_oxlint
            && let Some(key) = member.key()
            && let KeyKind::Ident(name) = key.kind()
        {
            self.check_plain(IdentifierLike::new(NameOf(member).ts_node(), key.span(cx.file()), name.bytes()), cx);
        }
    }

    fn export_spec<'a>(&self, specifier: ExportSpec<'a>, cx: &mut Cx<'a, Self>) {
        let exported = specifier.exported();
        if exported.is_string() {
            return;
        }
        let node = IdentifierLike::new(NameOf(specifier).ts_node(), exported.span(), exported.bytes());
        let symbol = node.node.get_symbol_at_location();
        // The alias itself is what is deprecated.
        if cx.state.of_symbol(symbol).is_some() {
            return;
        }
        let reason = cx.state.search_in_aliases_chain(symbol, true);
        self.report(node, reason, cx);
    }
}

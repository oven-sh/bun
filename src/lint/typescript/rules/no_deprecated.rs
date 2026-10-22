use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::types::utils::{
    StaticallyNamed, TypeOrValueSpecifier, parse_type_or_value_specifiers, type_matches_some_specifier,
    value_matches_some_specifier,
};
use bun_lint::types::{
    CheckFlags, IdMap, IdSet, Literal as LiteralValue, NameOf, Signature, SymbolFlags, SyntaxKind, TsNode, TsSymbol,
    Type,
};
use smallvec::SmallVec;
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

    /// For a name that isn't a node here.
    fn from_ident(ident: Ident<'a>, file: &'a File<'a>) -> Self {
        IdentifierLike::new(file.type_checker().ts_node(ident), ident.span(), ident.bytes())
    }
}

impl<'a> StaticallyNamed<'a> for IdentifierLike<'a> {
    fn get_static_name(self) -> Option<&'a [u8]> {
        (!self.is_super).then(|| self.name.strip_prefix(b"#").unwrap_or(self.name))
    }
}

/// Caches `getJsDocDeprecation` per file, because the same few symbols are used over and over.
#[derive(Default)]
pub struct Deprecations<'a> {
    /// Set for tsgolint, which checks each declaration itself, so a member doesn't inherit the tag of what it
    /// implements or overrides.
    ignores_inherited_tags: bool,
    symbol_reasons: IdMap<TsSymbol<'a>, Option<&'a [u8]>>,
    signature_reasons: IdMap<Signature<'a>, Option<&'a [u8]>>,
}

impl<'a> Deprecations<'a> {
    /// `getJsDocDeprecation(symbol)`
    fn for_symbol(&mut self, symbol: Option<TsSymbol<'a>>) -> Option<&'a [u8]> {
        let symbol = symbol?;
        let ignores_inherited_tags = self.ignores_inherited_tags;
        *self.symbol_reasons.get_or_insert_with(symbol, || match ignores_inherited_tags {
            true => symbol.declarations().find_map(deprecation_of_declaration),
            false => symbol.deprecation(),
        })
    }

    /// `getJsDocDeprecation(signature)`
    fn for_signature(&mut self, signature: Option<Signature<'a>>) -> Option<&'a [u8]> {
        let signature = signature?;
        let ignores_inherited_tags = self.ignores_inherited_tags;
        *self.signature_reasons.get_or_insert_with(signature, || match ignores_inherited_tags {
            true => signature.declaration().and_then(deprecation_of_declaration),
            false => signature.deprecation(),
        })
    }

    /// `searchForDeprecationInAliasesChain`: an alias on the way from an import to its final target can be deprecated,
    /// as in `export { /** @deprecated */ foo }`.
    fn search_in_aliases_chain(
        &mut self,
        symbol: Option<TsSymbol<'a>>,
        check_deprecations_of_aliased_symbol: bool,
    ) -> Option<&'a [u8]> {
        let mut symbol = symbol?;
        if !symbol.has_flags(SymbolFlags::ALIAS) {
            return match check_deprecations_of_aliased_symbol {
                true => self.for_symbol(Some(symbol)),
                false => None,
            };
        }
        let target_symbol = symbol.get_aliased_symbol();
        let mut seen = IdSet::new();
        while symbol.has_flags(SymbolFlags::ALIAS) && seen.insert(symbol) {
            if let Some(reason) = self.for_symbol(Some(symbol)) {
                return Some(reason);
            }
            symbol.declarations().next()?;
            symbol = symbol.get_immediate_aliased_symbol()?;
            if check_deprecations_of_aliased_symbol && symbol == target_symbol {
                return self.for_symbol(Some(symbol));
            }
        }
        None
    }

    /// `getCallLikeDeprecation(node)`, where `call` is `node.parent`.
    fn for_call_like(&mut self, node: TsNode<'a>, call: TsNode<'a>) -> Option<&'a [u8]> {
        if self.ignores_inherited_tags {
            return self.tsgolint_for_call_like(node, call);
        }
        let symbol = node.get_symbol_at_location();
        let aliased_symbol = symbol.map(TsSymbol::skip_alias);
        let symbol_declaration_kind = aliased_symbol.and_then(|it| it.declarations().next()).map(|it| it.kind());
        // A function or method has one declaration per overload, and a symbol's tags come from all of its declarations,
        // so the signature decides. A property with a function type has the tag on its symbol.
        let has_overloads = matches!(
            symbol_declaration_kind,
            Some(SyntaxKind::MethodDeclaration | SyntaxKind::FunctionDeclaration | SyntaxKind::MethodSignature)
        );
        if let Some(reason) = self.search_in_aliases_chain(symbol, !has_overloads) {
            return Some(reason);
        }
        if let Some(reason) = self.for_signature(call.get_resolved_signature()) {
            return Some(reason);
        }
        match has_overloads {
            true => None,
            false => self.for_symbol(aliased_symbol),
        }
    }

    /// tsgolint's `getCallLikeDeprecation`: the signature's declaration is checked before the symbol.
    fn tsgolint_for_call_like(&mut self, node: TsNode<'a>, call: TsNode<'a>) -> Option<&'a [u8]> {
        let signature = call.get_resolved_signature();
        if let Some(reason) = self.for_signature(signature) {
            return Some(reason);
        }
        let symbol = node.get_symbol_at_location()?;
        let aliased_symbol = symbol.skip_alias();
        let has_overloads = matches!(
            aliased_symbol.declarations().next().map(|it| it.kind()),
            Some(SyntaxKind::MethodDeclaration | SyntaxKind::FunctionDeclaration | SyntaxKind::MethodSignature)
        );
        if let Some(reason) = self.search_in_aliases_chain(Some(symbol), !has_overloads) {
            return Some(reason);
        }
        // If the signature has no declaration, any deprecated overload counts.
        match has_overloads && signature.and_then(Signature::declaration).is_none() {
            true => self.for_symbol(Some(aliased_symbol)),
            false => None,
        }
    }

    /// `getDeprecationReason(node)` for a `node` whose parent is a `Property`. `object_type` returns the type of the
    /// `ObjectExpression` or `ObjectPattern`.
    fn for_property(
        &mut self,
        node: TsNode<'a>,
        name: &[u8],
        object_type: impl FnOnce() -> Type<'a>,
    ) -> Option<&'a [u8]> {
        let property_symbol = node.get_symbol_at_location();
        if let Some(reason) = self.search_in_aliases_chain(property_symbol, true) {
            return Some(reason);
        }
        if let Some(reason) = self.for_symbol(object_type().get_property(name)) {
            return Some(reason);
        }
        if let Some(reason) = self.for_symbol(property_symbol) {
            return Some(reason);
        }
        let value_symbol = property_symbol?.value_declaration()?.get_shorthand_assignment_value_symbol();
        self.search_in_aliases_chain(value_symbol, true)
    }

    /// `getDeprecationReason(node)` for any other `node`.
    fn for_identifier(&mut self, node: TsNode<'a>) -> Option<&'a [u8]> {
        self.search_in_aliases_chain(node.get_symbol_at_location(), true)
    }

    /// `getDeprecationReason(node)` for an identifier that's `callee`, or the property of the `MemberExpression`
    /// `callee`.
    fn for_expression(&mut self, node: TsNode<'a>, callee: Expr<'a>) -> Option<&'a [u8]> {
        match get_call_like_node(callee) {
            Some((callee, call)) => self.for_call_like(callee.ts_node(), call.ts_node()),
            None => self.for_identifier(node),
        }
    }
}

/// `getCallLikeNode`: returns the callee and the call, if the callee is `callee` or a `MemberExpression` whose property
/// is `callee`.
fn get_call_like_node(mut callee: Expr<'_>) -> Option<(Expr<'_>, Expr<'_>)> {
    let is_oxlint = callee.file().language().is_oxlint;
    loop {
        // Its parent is a `ChainExpression`, or for tsgolint a `ParenthesizedExpression`.
        if callee.is_chain_root() || is_oxlint && callee.is_parenthesized() {
            return None;
        }
        let Node::Expr(parent) = callee.parent() else {
            return None;
        };
        match parent.kind() {
            // tsgolint only goes up from a `PropertyAccessExpression`'s name.
            ExprKind::Index { index, .. } if index == callee && !is_oxlint => callee = parent,
            ExprKind::Call(call) | ExprKind::New(call) | ExprKind::TaggedTemplate(call) => {
                return (call.callee() == callee).then_some((callee, parent));
            }
            // tsgolint: a `JsxOpeningElement`'s tag, even if it's a `PropertyAccessExpression`. A
            // `JsxSelfClosingElement`'s tag doesn't count as called.
            ExprKind::Jsx(jsx) if is_oxlint && jsx.tag() == Some(callee) && !jsx.is_self_closing() => {
                return Some((callee, parent));
            }
            _ => return None,
        }
    }
}

/// The `a = 1` in `[a = 1] = b`, `({ a = 1 } = b)` and `({ a = 1 })`. For tsgolint only the one in a shorthand
/// property, whose name `check_object` reports. The others are ordinary assignments.
fn is_assignment_pattern(assignment: Expr, is_oxlint: bool) -> bool {
    !is_oxlint && assignment.is_assignment_target()
        || matches!(assignment.parent(), Node::Prop(prop) if prop.kind() == PropKind::Shorthand)
}

/// Returns what tsgolint's `IsDeprecatedDeclaration` and `getJsDocDeprecationFromNode` find for a declaration: the tag
/// in its own comment, and for a variable the tag on its statement, which gives no reason. `TsNode::deprecation` is
/// `getJSDocTags`, which also looks at other nodes' comments.
// TODO(api): replace with a query for all the comments of the node itself
fn deprecation_of_declaration<'a>(declaration: TsNode<'a>) -> Option<&'a [u8]> {
    let has_tag = |node: TsNode<'a>| node.deprecation().is_some();
    let statement_of =
        |variable: TsNode<'a>| variable.ancestors().take(2).find(|it| it.kind() == SyntaxKind::VariableStatement);
    // `getRootDeclaration`
    let mut root = declaration;
    while root.kind() == SyntaxKind::BindingElement {
        root = root.parent()?.parent()?;
    }
    // `getCombinedNodeFlags`: applies to every variable of the statement.
    if root.kind() == SyntaxKind::VariableDeclaration && statement_of(root).is_some_and(has_tag) {
        return Some(&b""[..]);
    }
    let reason = root.deprecation()?;
    // The other places `getJSDocTags` takes the tag from: a variable's initializer, the thing a function or type is the
    // value of, and the `namespace A` of `namespace A.B`.
    let other_source = match (root.kind(), root.parent()) {
        (SyntaxKind::VariableDeclaration, _) => root.initializer(),
        (kind, Some(parent)) => match parent.kind() {
            SyntaxKind::PropertyAssignment
            | SyntaxKind::PropertyDeclaration
            | SyntaxKind::ReturnStatement
            | SyntaxKind::ExportAssignment => Some(parent),
            SyntaxKind::ModuleDeclaration if kind == SyntaxKind::ModuleDeclaration => Some(parent),
            SyntaxKind::VariableDeclaration => statement_of(parent),
            _ => None,
        },
        (_, None) => None,
    };
    if other_source.is_some_and(has_tag) {
        return None;
    }
    Some(if root == declaration { reason } else { &b""[..] })
}

/// `checker.isDeprecatedSymbol`: with several declarations, all have to be deprecated, except for an interface member.
fn is_deprecated_symbol(symbol: TsSymbol<'_>) -> bool {
    let mut declarations = symbol.declarations();
    // `getParentOfSymbol`: a property of a union, an intersection or a mapped type has none.
    let has_parent = !symbol.check_flags().intersects(CheckFlags::SYNTHETIC | CheckFlags::MAPPED);
    let is_in_interface = |declaration: TsNode<'_>| {
        declaration.parent().is_some_and(|parent| parent.kind() == SyntaxKind::InterfaceDeclaration)
    };
    match has_parent && declarations.len() > 1 && symbol.declarations().any(is_in_interface) {
        true => declarations.any(|it| deprecation_of_declaration(it).is_some()),
        false => declarations.all(|it| deprecation_of_declaration(it).is_some()),
    }
}

/// tsgolint's `getBindingPatternSourceType`: the type of the value a pattern destructures, derived from the variable's
/// initializer or from the parameter, property by property. `None` where it gives up.
fn get_binding_pattern_source_type(binding_pattern: TsNode<'_>) -> Option<Type<'_>> {
    // The `BindingElement`s and `ArrayBindingPattern`s on the way up. Each one takes a property of its parent's type.
    let mut steps: SmallVec<[TsNode<'_>; 4]> = SmallVec::new();
    let mut current = binding_pattern;
    let mut source_type = loop {
        match current.kind() {
            SyntaxKind::VariableDeclaration => break current.initializer()?.get_type_at_location(),
            SyntaxKind::Parameter => break current.get_type_at_location(),
            SyntaxKind::BindingElement | SyntaxKind::ArrayBindingPattern => steps.push(current),
            _ => {}
        }
        current = current.parent()?;
    };
    for step in steps.into_iter().rev() {
        source_type = match step.kind() {
            SyntaxKind::ArrayBindingPattern => match source_type.get_property(b"0") {
                Some(property) => property.get_type_at_location(step),
                None => source_type,
            },
            _ => {
                let name = match step.property_name() {
                    Some(property_name) if property_name.kind() == SyntaxKind::ComputedPropertyName => return None,
                    Some(property_name) => property_name.text(),
                    // Empty for a pattern.
                    None => step.name()?.text(),
                };
                if name.is_empty() {
                    return None;
                }
                source_type.get_property(name)?.get_type_at_location(step)
            }
        };
    }
    Some(source_type)
}

/// Returns the type in which tsgolint looks up whatever is under a `BindingElement` of `pattern`.
fn binding_pattern_source_type(pattern: Pat<'_>) -> Type<'_> {
    get_binding_pattern_source_type(pattern.ts_node()).unwrap_or_else(|| pattern.ty())
}

/// Returns the name tsgolint looks up for an identifier under a `BindingElement`: `bindingElem.PropertyName.Text()`, or
/// `own`, the identifier's own text. `None` for a computed property name, where it doesn't look anything up.
fn binding_property_name<'a>(property: PatProp<'a>, own: &'a [u8]) -> Option<&'a [u8]> {
    if property.is_rest() || property.is_shorthand() {
        return Some(own);
    }
    match property.key()?.kind() {
        KeyKind::Ident(name) | KeyKind::String(name) | KeyKind::Number(name) => Some(name.bytes()),
        _ => None,
    }
}

/// `services.getContextualType(openingElement.name)`
// TODO(api): replace with types::`Expr::contextual_type` of the tag name
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

/// tsgolint's version of a reason: `{@link a.b text}` is reduced to `text`.
fn without_link_targets(reason: &[u8]) -> Vec<u8> {
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
    /// The part of `checkIdentifier` that runs once it has the reason.
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
            true => Cow::Owned(without_link_targets(reason)),
            false => Cow::Borrowed(reason),
        };
        // tsgolint trims it after checking that it isn't empty.
        let trimmed = if is_oxlint { strings::trim_js_whitespace(&reason) } else { &reason[..] };
        match reason.is_empty() {
            true => cx.report(at, DEPRECATED).data("name", name),
            false => cx.report(at, DEPRECATED_WITH_REASON).data("name", name).data("reason", trimmed.to_vec()),
        };
    }

    /// For an identifier that needs no special handling.
    fn check_plain<'a>(&self, node: IdentifierLike<'a>, cx: &mut Cx<'a, Self>) {
        let reason = cx.state.for_identifier(node.node);
        self.report(node, reason, cx);
    }

    /// For a bound identifier that upstream doesn't treat as a declaration. `span` includes the type annotation.
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
        let is_oxlint = cx.language().is_oxlint;
        let mut node = e.ts_node();
        let reason = match e.parent() {
            // tsgolint treats any name whose parent is an arrow function or a parameter as a declaration. That covers
            // the function's returned expression and a default value.
            Node::Func(_) | Node::Param(_) if is_oxlint && !e.is_parenthesized() => return,
            Node::Expr(parent) => {
                match parent.kind() {
                    // `checkMemberExpression` handles it. For tsgolint it's an identifier like any other.
                    ExprKind::Index { index, .. } if index == e && !is_oxlint => return,
                    // An element of an `ArrayPattern`, which tsgolint doesn't treat as a declaration.
                    ExprKind::Array(_) if !is_oxlint && parent.is_assignment_target() => return,
                    ExprKind::Assign { target, .. } if target == e && is_assignment_pattern(parent, is_oxlint) => {
                        return;
                    }
                    // `check_jsx` handles it.
                    ExprKind::Jsx(jsx) if jsx.tag() == Some(e) || jsx.close_tag() == Some(e) => return,
                    _ => {}
                }
                cx.state.for_expression(node, e)
            }
            Node::Prop(prop)
                if prop.kind() != PropKind::Spread && !prop.is_jsx_attribute() && !prop.is_import_attribute() =>
            {
                let Node::Expr(object) = prop.parent() else {
                    return;
                };
                if is_oxlint && prop.kind() != PropKind::Shorthand {
                    // For tsgolint a value, even in a pattern, and a computed key are identifiers like any other.
                    cx.state.for_identifier(node)
                } else {
                    // Upstream treats the value in a pattern and the key in an object as a declaration, even if the key
                    // is computed.
                    if (prop.value() == Some(e)) == object.is_assignment_target() {
                        return;
                    }
                    if prop.kind() == PropKind::Shorthand {
                        node = NameOf(prop).ts_node();
                    }
                    cx.state.for_property(node, name, || object.ty())
                }
            }
            // tsgolint looks up an identifier that's a `BindingElement`'s default as a property of the destructured
            // value, by the property name or else by its own name. A computed key is an identifier like any other.
            Node::PatProp(prop) if is_oxlint => match prop.default() == Some(e) && !e.is_parenthesized() {
                true => {
                    let Some(property_name) = binding_property_name(prop, name) else {
                        return;
                    };
                    let Node::Pat(pattern) = prop.parent() else {
                        return;
                    };
                    cx.state.for_property(node, property_name, || binding_pattern_source_type(pattern))
                }
                false => cx.state.for_identifier(node),
            },
            // A computed key.
            Node::PatProp(prop) if prop.default() != Some(e) => {
                let Node::Pat(pattern) = prop.parent() else {
                    return;
                };
                cx.state.for_property(node, name, || pattern.ty())
            }
            // A computed key. Upstream doesn't handle abstract members. For tsgolint it's an identifier like any other.
            Node::Member(member)
                if !is_oxlint
                    && !member.flags().contains(Flags::ABSTRACT)
                    && matches!(member.key().map(Key::kind), Some(KeyKind::Computed(key)) if key == e) =>
            {
                return;
            }
            Node::EnumMember(member) if member.init() != Some(e) => return,
            _ => cx.state.for_identifier(node),
        };
        self.report(IdentifierLike::new(node, e.span(), name), reason, cx);
    }

    /// The `property` of a non-computed `MemberExpression`, the `right` of a `TSQualifiedName` in a `typeof` type, or
    /// the `property` of a `JSXMemberExpression`.
    fn check_property<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Dot { name, .. } = e.kind() else {
            return;
        };
        let node = IdentifierLike::new(NameOf(e).ts_node(), name.span(), name.bytes());
        let reason = cx.state.for_expression(node.node, e);
        self.report(node, reason, cx);
    }

    fn check_super<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let node = IdentifierLike { node: e.ts_node(), span: e.span(), name: b"super", is_super: true };
        let reason = cx.state.for_expression(node.node, e);
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
        let Some(reason) = cx.state.for_symbol(property) else {
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

    /// The `JSXIdentifier`s that name an opening element or an attribute.
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
            let reason = match cx.language().is_oxlint && jsx.is_self_closing() {
                // For tsgolint a `JsxSelfClosingElement`'s tag isn't called, so the symbol decides.
                true => cx.state.for_identifier(node.node),
                false => cx.state.for_call_like(node.node, element.ts_node()),
            };
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
            if let Some(reason) = cx.state.for_symbol(contextual_type.get_property(name.bytes())) {
                let node = IdentifierLike::new(NameOf(attribute).ts_node(), key.span(cx.file()), name.bytes());
                self.report(node, Some(reason), cx);
            }
        }
    }

    /// The keys of an `ObjectPattern` in an assignment.
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
                let reason = cx.state.for_property(node.node, node.name, || object.ty());
                self.report(node, reason, cx);
            }
        }
    }

    /// tsgolint's `checkObjectLiteralPropertyDeprecation`: reports a property that sets one that's deprecated in the
    /// object's contextual type.
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
            // `getObjectLiteralPropertyName`
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
            let symbol = expected.get_property(name).filter(|it| is_deprecated_symbol(*it));
            let Some(reason) = cx.state.for_symbol(symbol) else {
                continue;
            };
            // tsgolint also matches `allow` against the object's contextual type.
            if type_matches_some_specifier(expected, &self.allow) {
                continue;
            }
            let node = IdentifierLike::new(NameOf(property).ts_node(), key.span(cx.file()), name);
            self.report(node, Some(reason), cx);
        }
    }

    /// The identifiers tsgolint finds under an `ObjectBindingPattern`'s `BindingElement`s: the property name and the
    /// bound name, each looked up as the destructured property.
    fn check_binding_pattern_as_tsgolint<'a>(&self, pattern: Pat<'a>, cx: &mut Cx<'a, Self>) {
        let PatKind::Object(properties) = pattern.kind() else {
            return;
        };
        let mut source_type = None;
        for property in properties {
            let value = property.value();
            let bound = value.as_ident().map(|name| IdentifierLike::new(value.ts_node(), value.span(), name.bytes()));
            let Some(property_name) = binding_property_name(property, bound.map_or(&b""[..], |it| it.name)) else {
                continue;
            };
            // The `a` in `{ a: b }`.
            let key = match property.key() {
                Some(key) if !property.is_shorthand() => match key.kind() {
                    KeyKind::Ident(name) => (property.ts_node().property_name())
                        .map(|node| IdentifierLike::new(node, key.span(cx.file()), name.bytes())),
                    _ => None,
                },
                _ => None,
            };
            for node in [key, bound].into_iter().flatten() {
                let reason = cx.state.for_property(node.node, property_name, || {
                    *source_type.get_or_insert_with(|| binding_pattern_source_type(pattern))
                });
                self.report(node, reason, cx);
            }
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
        Some(Deprecations { ignores_inherited_tags: is_oxlint, ..Deprecations::default() })
    }

    /// For tsgolint the name of a parameter, a `catch` clause, `namespace A.B {}` or an abstract member is a
    /// declaration, and so is anything an array pattern binds.
    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        if !file.language().is_oxlint {
            return Self::ON;
        }
        On::new()
            .exprs(&[
                ExprTag::Ident,
                ExprTag::Dot,
                ExprTag::Index,
                ExprTag::Super,
                ExprTag::PrivateIdentifier,
                ExprTag::Jsx,
                ExprTag::Object,
            ])
            .pats(&[PatTag::Object])
            .types(&[TypeTag::Ref, TypeTag::Import, TypeTag::Predicate])
            .stmts(&[StmtTag::ImportEquals])
            .export_specs()
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

    /// The keys of a declaring `ObjectPattern`, and the argument of a `RestElement` in a pattern.
    fn pat<'a>(&self, pattern: Pat<'a>, cx: &mut Cx<'a, Self>) {
        if cx.language().is_oxlint {
            return self.check_binding_pattern_as_tsgolint(pattern, cx);
        }
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
                    let reason = cx.state.for_property(node.node, node.name, || pattern.ty());
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

    /// Upstream treats the parameters of some kinds of functions as declarations, but never a `RestElement`.
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
                    self.check_plain(IdentifierLike::from_ident(parameter_name, cx.file()), cx);
                }
            }
            _ => {}
        }
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        match statement.kind() {
            // A `CatchClause`'s parameter.
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
                        self.check_plain(IdentifierLike::from_ident(name, cx.file()), cx);
                    }
                    at = module.nested();
                }
            }
            _ => {}
        }
    }

    /// Upstream doesn't treat an abstract member's key as a declaration.
    fn member<'a>(&self, member: Member<'a>, cx: &mut Cx<'a, Self>) {
        if member.flags().contains(Flags::ABSTRACT)
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
        // The alias itself is deprecated.
        if cx.state.for_symbol(symbol).is_some() {
            return;
        }
        let reason = cx.state.search_in_aliases_chain(symbol, true);
        self.report(node, reason, cx);
    }
}

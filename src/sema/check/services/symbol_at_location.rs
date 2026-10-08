//! `getSymbolAtLocation`: what a name refers to.
//!
//! Members of classes, interfaces, type literals and object literals have no `SymbolId`: such a
//! symbol is a [`Prop`].

use super::super::*;
use super::symbols::Key;
use super::visited::VisitedKind;
use super::{NodeRef, Services, SymbolFlags, SymbolRef};
use crate::bind::{Decl, FnOwner, Parent, PatParent, ScopeKind};
use crate::node::{Kind, Node, NodeData, Part};

/// An entry of `symbol.Declarations`.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(in crate::check) enum Declaration {
    #[cfg_attr(not(feature = "baselines"), expect(dead_code))]
    Bound(Decl),
    /// A function expression or an object literal.
    Expression(ExprId),
    /// A type literal or a mapped type.
    TypeNode(TypeNodeId),
    ThisParameter(FnId),
}

/// A property that is found in a type, or is made up for the declaration of one.
pub(in crate::check) enum FoundProp<'p> {
    Of(&'p Prop<'p>),
    Made(Prop<'p>),
}

impl<'p> std::ops::Deref for FoundProp<'p> {
    type Target = Prop<'p>;
    #[inline]
    fn deref(&self) -> &Prop<'p> {
        match self {
            FoundProp::Of(prop) => prop,
            FoundProp::Made(prop) => prop,
        }
    }
}

/// A symbol without declarations.
pub(in crate::check) enum Undeclared {
    /// `arguments`, `require`
    Name(Atom),
    /// `getUnresolvedSymbolForEntityName`
    Path(Vec<Atom>),
    /// The `const` of `as const`: a type reference that resolves to nothing.
    Const,
    /// The `meta` of `import.meta`.
    ImportMeta,
    GlobalThis,
}

/// What `getSymbolAtLocation` returns.
pub(in crate::check) enum Found<'p> {
    Symbol(Sym),
    /// With the mapper to read it with.
    Property(FoundProp<'p>, MapperId),
    /// What `createUnionOrIntersectionProperty` makes for a union, with the mapper to read it with.
    Properties(&'p Prop<'p>, MapperId),
    /// A symbol with one declaration that is in no table: `__object`, `__type`, a `this` parameter.
    Anonymous {
        file: FileId,
        declaration: Declaration,
    },
    Undeclared(Undeclared),
    /// The `prototype` of a class: no declarations, and the class as its parent.
    Prototype(Sym),
    /// The `default` that `createDefaultPropertyWrapperForModule` creates: no declarations, and the
    /// module as its parent.
    SyntheticDefault(Sym),
    /// `getApplicableIndexSymbol`: `__index`, declared by the index signature of `of` that applies.
    /// The parent is `t.symbol`.
    IndexSignature {
        of: TypeId,
        #[cfg_attr(not(feature = "baselines"), expect(dead_code))]
        parent: Option<Sym>,
        declarations: Vec<(FileId, MemberId)>,
    },
}

impl<'p> Found<'p> {
    fn made(prop: Prop<'p>) -> Found<'p> {
        Found::Property(FoundProp::Made(prop), MapperId::IDENTITY)
    }
}

/// `getSymbolAtLocation` for the nodes of one file.
pub(in crate::check) struct SymbolFinder<'c, 'p, 's> {
    pub(in crate::check) c: &'c mut Checker<'p, 's>,
    pub(in crate::check) file: FileId,
}

impl<'p> SymbolFinder<'_, 'p, '_> {
    /// `getSymbolAtLocation`
    pub(in crate::check) fn get_symbol_at_visited_node(
        &mut self,
        kind: VisitedKind,
    ) -> Option<Found<'p>> {
        let file = self.file;
        let (hir, bound, files) = (self.c.hir(file), self.c.bound(file), self.c.files());
        match kind {
            VisitedKind::DeclarationName(decl, id)
            | VisitedKind::SpecifierPropertyName(decl, id) => {
                if id.is_none() {
                    return None;
                }
                let symbol = files.sym(file, id);
                if matches!(kind, VisitedKind::DeclarationName(..)) {
                    return Some(Found::Symbol(symbol));
                }
                // `getImmediateAliasedSymbol`: the `a` of `import { a as b }` and of `export { a as
                // b }`.
                // `getTargetOfModuleDefault`: a synthesized default is
                // `resolveExternalModuleSymbol(moduleSymbol, dontResolveAlias)`, which stops at the
                // `export =` of the module.
                if let Some((specifier, mode, known::default)) =
                    files.external_module_member_of(file, decl)
                    && let Some(module) = files.module_of_specifier_as(file, specifier, mode)
                    && let Some(equals) = files.export(module, known::export_equals)
                    && files.alias_target(symbol) == Some(files.module_value(module))
                {
                    return Some(Found::Symbol(equals));
                }
                match files.alias_target(symbol) {
                    Some(target) => Some(Found::Symbol(files.canonical(target))),
                    // `getExternalModuleMember`: a property of the value a module exports with
                    // `export =`.
                    None => self
                        .c
                        .property_of_alias(symbol)
                        .map(|prop| Found::Property(FoundProp::Of(prop), MapperId::IDENTITY)),
                }
            }
            // `IsLiteralComputedPropertyDeclarationName`: the literal in `["name"]`, `` [`name`] `` and `[0]` has the symbol of the
            // declaration.
            VisitedKind::LiteralInEnumMemberName(m) => Some(Found::Symbol(
                files.sym(file, bound.enum_member_symbol[m.idx()]),
            )),
            // `declareSymbolEx`: a name that declares nothing, `#x` outside a class or `1n`, still
            // gets a symbol (`InternalSymbolNameMissing`), which is in no symbol table.
            VisitedKind::MemberName(m) | VisitedKind::LiteralInMemberName(m) => {
                let start = hir[m].name_pos;
                (!matches!(hir[m].key, PropKey::None) || is_literal_name_at(hir, start))
                    .then(|| self.property_of_member(m))
            }
            VisitedKind::PropertyName(p) | VisitedKind::LiteralInPropertyName(p) => {
                let name = hir[p].key.name().unwrap_or(Atom::NONE);
                (!matches!(hir[p].key, PropKey::None) || is_literal_name_at(hir, hir[p].pos)).then(
                    || {
                        Found::made(Prop {
                            name,
                            flags: PropFlags::empty(),
                            source: PropSource::Literal(file, p),
                            mapper: MapperId::IDENTITY,
                        })
                    },
                )
            }
            VisitedKind::BindingName(pat) => {
                let PatKind::Ident(name) = hir[pat].kind else {
                    return None;
                };
                // `bindParameter` declares the property last, so that is the symbol of the node. `IsParameterPropertyDeclaration`
                if let PatParent::Param(parameter) = bound.pat_parent[pat.idx()]
                    && hir[parameter].flags.contains(Flags::PARAMETER_PROPERTY)
                    && hir[bound.param_fn[parameter.idx()]].kind == FnKind::Constructor
                {
                    let property = bound.symbol_of_declaration(Decl::ParameterProperty(parameter));
                    return Some(Found::made(Prop {
                        name,
                        flags: PropFlags::empty(),
                        source: PropSource::Symbol(files.sym(file, property)),
                        mapper: MapperId::IDENTITY,
                    }));
                }
                let symbol = bound.pat_symbol[pat.idx()];
                symbol
                    .is_some()
                    .then(|| Found::Symbol(files.sym(file, symbol)))
            }
            // `{ ["name"]: local }`: the binding element is the declaration.
            VisitedKind::LiteralInBindingPropertyName(p) => {
                let value = hir[p].value;
                if value.is_none() || !matches!(hir[value].kind, PatKind::Ident(_)) {
                    return None;
                }
                let symbol = bound.pat_symbol[value.idx()];
                symbol
                    .is_some()
                    .then(|| Found::Symbol(files.sym(file, symbol)))
            }
            // `{ name: local }`: the property of the type of the pattern.
            VisitedKind::BindingPropertyName(p) => {
                let parent = bound.pat_parent[hir[p].value.idx()];
                let (PropKey::Name(name), PatParent::Prop(pattern, _)) = (hir[p].key, parent)
                else {
                    return None;
                };
                // `getTypeOfNode` of a binding pattern is `getTypeForVariableLikeDeclaration` of its parent: of a parameter,
                // `getContextuallyTypedParameterType`. "If inference didn't come up with anything but unknown, fall back to the
                // binding pattern" (`assignParameterType`) only reaches the type of the symbol.
                if let PatParent::Param(param) = bound.pat_parent[pattern.idx()]
                    && hir[param].ty.is_none()
                {
                    let func = bound.param_fn[param.idx()];
                    let index = (param.0 - hir[func].params.start) as usize;
                    if self.c.contextual_param_type(file, func, index) == Some(TypeId::UNKNOWN) {
                        return None;
                    }
                }
                let ty = self.c.type_of_pat(file, pattern);
                self.get_property_of_type(ty, name)
            }
            VisitedKind::ThisParameter(f) => self.this_parameter(file, f),
            VisitedKind::Expression(e) | VisitedKind::AccessName(e) => {
                let is_name = matches!(kind, VisitedKind::AccessName(_));
                self.get_symbol_of_expression(e, is_name)
            }
            // A type reference that resolves to nothing.
            VisitedKind::ConstOfAsConst(_) => Some(Found::Undeclared(Undeclared::Const)),
            // `getIntrinsicTagSymbol`
            VisitedKind::JsxIntrinsicTagName(element, tag) => {
                let (ExprKind::String(name) | ExprKind::Ident(name)) = hir[tag].kind else {
                    return None;
                };
                let location = hir.node(element);
                let elements = self.c.jsx_type(file, location, known::IntrinsicElements)?;
                match self.c.prop_ref(elements, name) {
                    Some((prop, mapper)) => Some(Found::Property(FoundProp::Of(prop), mapper)),
                    None => match self.get_applicable_index_symbol(elements, name) {
                        Some(found) => Some(found),
                        // An index signature without a declaration, such as that of `Record<string,
                        // any>`: `intrinsicElementsType.symbol`.
                        None => {
                            let members = self.c.members(elements)?;
                            self.c.applicable_index_info_for_name(&members, name)?;
                            self.symbol_of_type(elements)
                        }
                    },
                }
            }
            VisitedKind::TypeReferenceName(node, index)
            | VisitedKind::HeritageClauseName(node, index)
            | VisitedKind::HeritageClausePropertyAccess(node, index) => {
                let scope = bound.type_scope[node.idx()];
                let TypeNodeKind::Ref { name, .. } = hir[node].kind else {
                    return None;
                };
                if scope.is_none() {
                    return None;
                }
                let names: Vec<Atom> = hir.texts(name).take(index as usize + 1).collect();
                let meaning = if names.len() == name.len() {
                    SymFlags::TYPE
                } else {
                    SymFlags::NAMESPACE
                };
                match self.c.resolve_entity(file, scope, &names, meaning) {
                    Some(symbol) => Some(Found::Symbol(symbol)),
                    None if !matches!(kind, VisitedKind::TypeReferenceName(..)) => None,
                    // `getUnresolvedSymbolForEntityName`, which is `unknownSymbol` for a missing
                    // name.
                    None if names.last() == Some(&known::empty) => {
                        Some(Found::Symbol(files.unknown_symbol))
                    }
                    None => Some(Found::Undeclared(Undeclared::Path(names))),
                }
            }
            // `getTypeFromImportTypeNode`: the identifiers of the qualifier.
            VisitedKind::ImportTypeQualifierName(node, index) => {
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
                if bound.type_scope[node.idx()].is_none() {
                    return None;
                }
                let module =
                    files.module_of_specifier_as(file, spec, files.mode_of_import(file, mode))?;
                let mut found = files.module_value(module);
                // `getTypeFromImportTypeNode`, `isTypeOf`: each name is a property of the type of
                // the preceding part.
                if is_typeof {
                    let mut ty = self.c.type_of_symbol(found);
                    let mut last = None;
                    for part in hir.texts(name).take(index as usize + 1) {
                        last = self.get_property_of_type(ty, part);
                        ty = self.c.type_of_property(ty, part)?;
                    }
                    return last;
                }
                for (at, part) in hir.texts(name).enumerate().take(index as usize + 1) {
                    let meaning = if at + 1 < name.len() {
                        SymFlags::NAMESPACE
                    } else {
                        SymFlags::TYPE
                    };
                    let container = files.resolve_alias_if_needed(found)?;
                    found = files.namespace_member(container, part)?;
                    if !files.means(found, meaning) {
                        return None;
                    }
                }
                Some(Found::Symbol(found))
            }
            VisitedKind::TypePredicateParameter(node) => {
                let TypeNodeKind::Predicate { param, .. } = hir[node].kind else {
                    return None;
                };
                let scope = bound.type_scope[node.idx()];
                if scope.is_none() {
                    return None;
                }
                files
                    .resolve_name(file, scope, param, SymFlags::FUNCTION_SCOPED_VARIABLE)
                    .map(Found::Symbol)
            }
            // `getSymbolOfPartOfRightHandSideOfImportEquals`
            VisitedKind::ImportEqualsName(import, index) => {
                let ImportEqualsTarget::Entity(list) = hir[import].target else {
                    return None;
                };
                let names: Vec<Atom> = hir.texts(list).take(index as usize + 1).collect();
                let meaning = if index > 0 && names.len() == list.len() {
                    SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE
                } else {
                    SymFlags::NAMESPACE
                };
                let scope = bound.import_equals_scope[import.idx()];
                files
                    .resolve_entity(file, scope, &names, meaning)
                    .map(Found::Symbol)
            }
            VisitedKind::Parenthesized(..)
            | VisitedKind::ModuleSpecifier(_)
            | VisitedKind::ImportDeferName(_)
            | VisitedKind::JsxNamespacedNamePart
            | VisitedKind::ImportAttributeName(_)
            | VisitedKind::LiteralType(_)
            | VisitedKind::LiteralTypeOperand(_)
            | VisitedKind::Label(_) => None,
        }
    }

    /// `getSymbolAtLocation` for the expression `e`, or for its final name.
    fn get_symbol_of_expression(&mut self, e: ExprId, is_name: bool) -> Option<Found<'p>> {
        let file = self.file;
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        if let Some(found) = self.get_symbol_of_name_in_class_extends(e) {
            return Some(found);
        }
        match hir[e].kind {
            // Not bound.
            _ if matches!(bound.expr_parent[e.idx()], Parent::None) => None,
            ExprKind::Ident(name) => self.get_symbol_of_identifier(e, name),
            // `isRightSideOfQualifiedNameOrPropertyAccess`: the name has the symbol of the whole access.
            ExprKind::Dot {
                obj, name, chain, ..
            } => {
                let (access, _) = self.c.left_type_of_property_access(file, e, obj, chain);
                if access.any_like.is_some() {
                    return None;
                }
                let ty = access.widened;
                if self.c.is_apparently_unknown(ty) {
                    return None;
                }
                // `skipObjectFunctionPropertyAugment`: a `const enum` has no `toString`.
                if self.c.is_const_enum_object(ty)
                    && self
                        .c
                        .members(ty)
                        .is_none_or(|members| members.shape().prop(name).is_none())
                {
                    return None;
                }
                // `checkQualifiedName`: `includeTypeOnlyMembers`, so `export type { A }` counts in `typeof ns.A`.
                let queried_module = match *self.c.data(ty) {
                    TypeData::Anon {
                        origin: Origin::Module(module) | Origin::Namespace { module, .. },
                        ..
                    } if bound.is_in_type_query(e) => Some(module),
                    _ => None,
                };
                match self.get_property_of_type(access.apparent, name) {
                    Some(found) => Some(found),
                    None if self.c.is_private_name(name) => None,
                    None if queried_module.is_some() => queried_module
                        .and_then(|module| self.c.files().namespace_member(module, name))
                        .map(Found::Symbol),
                    // `checkExpressionCached(name.Expression())`: the type unchanged, including its
                    // `undefined`.
                    None => {
                        let ty = self.c.type_of_expr(file, obj);
                        self.get_applicable_index_symbol(ty, name)
                    }
                }
            }
            ExprKind::PrivateIdentifier(name) if hir.is_expression_node(hir.node(e)) => {
                self.get_symbol_for_private_identifier_expression(e, name)
            }
            ExprKind::String(_) | ExprKind::Number(_) | ExprKind::Template { .. } => {
                self.get_symbol_of_literal(e)
            }
            ExprKind::This => {
                let is_queried = bound.is_in_type_query(e);
                // `GetThisContainer`
                let function = match self.c.this_container(file, e) {
                    Some(Ok(function)) => Some(function),
                    _ => None,
                };
                if let Some(found) =
                    function.and_then(|function| self.this_parameter_of_function(function))
                {
                    return Some(found);
                }
                // `IsInExpressionContext`: false for the `this` of a bare `typeof this`, whose
                // parent is the type query, so its symbol is `getThisType(node).symbol`, which
                // narrowing does not affect. The `this` of `typeof this.x` is under a qualified
                // name, which is an expression node.
                if is_queried
                    && !matches!(bound.expr_parent[e.idx()], Parent::Expr(_))
                    && let Some(function) = function
                {
                    return match bound.fns[function.idx()].owner {
                        FnOwner::Member(m) if !hir[m].flags.contains(Flags::STATIC) => {
                            self.c.symbol_of_member_owner(file, m).map(Found::Symbol)
                        }
                        _ => None,
                    };
                }
                // `c.checkExpression(node).symbol`, which is not memoised.
                let ty = self.c.get_type_of_expression_after_check(file, e);
                self.symbol_of_type(ty)
            }
            // The `meta` of `import.meta` is the member of `getGlobalImportMetaExpressionType`.
            ExprKind::ImportMeta if is_name => Some(Found::Undeclared(Undeclared::ImportMeta)),
            // `getSymbolAtLocation`, `KindMetaProperty`: the name has a symbol only if it is the
            // expected one.
            ExprKind::NewTarget(name) if is_name && self.c.atoms().bytes(name) != b"target" => None,
            // `checkExpression(node).symbol`. The `target` of `new.target` has the same symbol.
            ExprKind::Super | ExprKind::ImportMeta | ExprKind::NewTarget(_) => {
                let ty = self.c.type_of_expr(file, e);
                self.symbol_of_type(ty)
            }
            _ => None,
        }
    }

    /// `isInNameOfExpressionWithTypeArguments`, in the extends clause of a class: `e` is either the
    /// whole entity name expression, resolved with the value meaning, or the part before a dot in
    /// it, resolved with the namespace meaning. An alias matches regardless of its target.
    fn get_symbol_of_name_in_class_extends(&self, e: ExprId) -> Option<Found<'p>> {
        let (hir, bound) = (self.c.hir(self.file), self.c.bound(self.file));
        let mut whole = e;
        loop {
            match bound.expr_parent[whole.idx()] {
                Parent::ClassExtends(_) => break,
                Parent::Expr(access)
                    if access.is_some()
                        && !is_parenthesized(hir, whole)
                        && matches!(hir[access].kind, ExprKind::Dot { obj, .. } if obj == whole) =>
                {
                    whole = access;
                }
                _ => return None,
            }
        }
        // `IsEntityNameExpression`
        let (mut names, mut at) = (Vec::new(), e);
        loop {
            match hir[at].kind {
                ExprKind::Ident(name) => names.push(name),
                ExprKind::Dot { obj, name, .. } if !is_parenthesized(hir, obj) => {
                    names.push(name);
                    at = obj;
                    continue;
                }
                _ => return None,
            }
            break;
        }
        names.reverse();
        let meaning = if whole == e {
            SymFlags::VALUE
        } else {
            SymFlags::NAMESPACE
        };
        let &scope = bound.expr_scope.get(&whole)?;
        let files = self.c.files();
        let found = files.resolve_entity(self.file, scope, &names, meaning | SymFlags::ALIAS);
        // `resolveEntityName`: `else if namespace == c.unknownSymbol { return namespace }`
        let namespace = SymFlags::NAMESPACE | SymFlags::ALIAS;
        if found.is_none()
            && names.len() > 1
            && let Some(first) = files.resolve_name(self.file, scope, names[0], namespace)
            && files.resolve_alias(first).is_none()
        {
            return Some(Found::Symbol(files.unknown_symbol));
        }
        found.map(Found::Symbol)
    }

    /// `getSymbolForPrivateIdentifierExpression`, for the `#x` of `#x in a`.
    fn get_symbol_for_private_identifier_expression(
        &mut self,
        e: ExprId,
        name: Atom,
    ) -> Option<Found<'p>> {
        let (hir, bound) = (self.c.hir(self.file), self.c.bound(self.file));
        let &class = bound.private_class.get(&e)?;
        // `lookupSymbolForPrivateIdentifierDeclaration`: the members of the class before its statics.
        let declaration = |is_static: bool| {
            hir[class].members.iter().find(|&member| {
                hir[member].key == PropKey::Private(name)
                    && hir[member].flags.contains(Flags::STATIC) == is_static
            })
        };
        let member = declaration(false).or_else(|| declaration(true))?;
        Some(self.property_of_member(member))
    }

    /// `getSymbolAtLocation` for a string, a number or a template without substitutions.
    fn get_symbol_of_literal(&mut self, e: ExprId) -> Option<Found<'p>> {
        let file = self.file;
        let (hir, bound, files) = (self.c.hir(file), self.c.bound(file), self.c.files());
        let Parent::Expr(parent) = bound.expr_parent[e.idx()] else {
            return None;
        };
        if parent.is_none() {
            return None;
        }
        let specifier = |mode: ResolutionMode| match hir[e].kind {
            ExprKind::String(text) => files
                .module_of_specifier_as(file, text, mode)
                .map(Found::Symbol),
            _ => None,
        };
        let name = match hir[e].kind {
            ExprKind::String(text) => text,
            ExprKind::Number(number) => self.c.number_name(hir.numbers[number as usize]),
            ExprKind::Template { exprs } if exprs.is_empty() => {
                hir.id_at(hir.template_texts(exprs), 0)
            }
            _ => return None,
        };
        match hir[parent].kind {
            // `a["name"]`, `a[0]`
            ExprKind::Index { obj, index, .. } if index == e && !is_parenthesized(hir, e) => {
                let ty = self.c.type_of_expr(file, obj);
                self.get_property_of_type(ty, name)
            }
            // `resolveExternalModuleName`
            ExprKind::ImportCall { args, .. } if hir.id_at(args, 0) == e => {
                specifier(files.mode_of_import_call(file))
            }
            // `IsVariableDeclarationInitializedToRequire`
            ExprKind::Call(_)
                if matches!(bound.expr_parent[parent.idx()], Parent::VarInit(d)
                    if bound.required_by(hir, hir[d].pat).is_some()
                        && !hir[d].flags.contains(Flags::EXPORT))
                    && crate::bind::require_argument(hir, parent) == Some(e) =>
            {
                specifier(ResolutionMode::Require)
            }
            // `getSymbolOfDeclaration(parent)`: the key of `Object.defineProperty(object, "name", descriptor)`, which declares
            // the property in JavaScript.
            ExprKind::Call(_) if hir.is_js && !matches!(hir[e].kind, ExprKind::Number(_)) => {
                let (object, key) = crate::bind::define_property_call(hir, parent)?;
                // Nil where the binder did not treat the call as a declaration:
                // `Object.defineProperty(module, "exports", ..)`.
                let is_declaration = bound.is_expando_declaration(parent)
                    || crate::bind::assignment_declaration_kind(hir, parent)
                        == crate::bind::JsDeclarationKind::ObjectDefinePropertyExports;
                if key != e || !is_declaration {
                    return None;
                }
                let ty = self.c.type_of_expr(file, object);
                self.get_property_of_type(ty, name)
            }
            _ => None,
        }
    }

    /// `member.Symbol` for a member of the file being written.
    fn property_of_member(&mut self, member: MemberId) -> Found<'p> {
        let file = self.file;
        let name = self
            .c
            .declared_member_name(file, self.c.hir(file)[member].key);
        Found::made(Prop {
            name: name.unwrap_or(Atom::NONE),
            flags: PropFlags::empty(),
            source: PropSource::Symbol(self.c.symbol_of_member(file, member)),
            mapper: MapperId::IDENTITY,
        })
    }

    /// `getSignatureFromDeclaration(function).thisParameter`
    fn this_parameter_of_function(&mut self, function: FnId) -> Option<Found<'p>> {
        let file = self.file;
        if let Some(found) = self.this_parameter(file, function) {
            return Some(found);
        }
        // "If only one accessor includes a this-type annotation, the other behaves as if it had the same type annotation"
        let other = match self.c.hir(file)[function].kind {
            FnKind::Getter => self.c.sibling_accessor(file, function, FnKind::Setter),
            FnKind::Setter => self.c.sibling_accessor(file, function, FnKind::Getter),
            _ => None,
        };
        if let Some(found) = other.and_then(|(file, other)| self.this_parameter(file, other)) {
            return Some(found);
        }
        // `assignContextualParameterTypes`: a copy of that of the contextual signature, with its declarations.
        let FnOwner::Expr(owner) = self.c.bound(file).fns[function.idx()].owner else {
            return None;
        };
        if !self
            .c
            .is_context_sensitive_function_or_method(file, function, owner)
        {
            return None;
        }
        let context = self.c.contextual_signature(file, function)?;
        let (file, function, _) = self.c.sig_decl(context)?;
        self.this_parameter(file, function)
    }

    /// The symbol of the `this` parameter that `function` declares.
    fn this_parameter(&self, file: FileId, function: FnId) -> Option<Found<'p>> {
        let hir = self.c.hir(file);
        hir.params.get(hir[function].this_param.idx())?;
        Some(Found::Anonymous {
            file,
            declaration: Declaration::ThisParameter(function),
        })
    }

    // ───────────────────────────── `getSymbolAtLocation` ─────────────────────────────

    /// `resolveEntityName(name, SymbolFlagsValue, ..)` for the identifier `e` that
    /// `checkIdentifier` resolves to `exported`. `checkIdentifier` also requests `ExportValue`, and
    /// follows the local symbol it finds to `ExportSymbol`. Without `ExportValue` a local symbol
    /// that is not a value is skipped in favor of the entry in the exports table.
    fn resolve_without_export_value(&self, e: ExprId, name: Atom, exported: Sym) -> Option<Sym> {
        let (file, files, bound) = (self.file, self.c.files(), self.c.bound(self.file));
        let mut scope = self.c.enclosing_scope_of_expr(file, e);
        while scope.is_some() {
            let s = &bound.scopes[scope.idx()];
            if matches!(s.kind, ScopeKind::File | ScopeKind::Module(_))
                && let Some(local) = bound.lookup(s.locals, name)
            {
                let leads_there = bound.symbols[local.idx()].export_symbol.is_some()
                    && files.export_symbol_of_value_symbol_if_exported(files.sym(file, local))
                        == exported;
                return if leads_there {
                    files.resolve_name(file, scope, name, SymFlags::VALUE)
                } else {
                    Some(exported)
                };
            }
            scope = s.parent;
        }
        Some(exported)
    }

    /// `getSymbolOfNameOrPropertyAccessExpression` for an identifier that is an expression.
    fn get_symbol_of_identifier(&self, e: ExprId, name: Atom) -> Option<Found<'p>> {
        let file = self.file;
        let (hir, bound, files) = (self.c.hir(file), self.c.bound(file), self.c.files());

        // `export default a`, `export = a`: all meanings are accepted.
        if let Parent::Stmt(statement) = bound.expr_parent[e.idx()]
            && statement.is_some()
            && matches!(
                hir[statement].kind,
                StmtKind::ExportDefault(_) | StmtKind::ExportAssign(_)
            )
            && !is_parenthesized(self.c.hir(file), e)
            && let Some(&scope) = bound.expr_scope.get(&e)
            && let Some(symbol) = files.resolve_name(
                file,
                scope,
                name,
                SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE | SymFlags::ALIAS,
            )
        {
            return Some(Found::Symbol(symbol));
        }
        // `ignoreErrors`
        match self
            .c
            .resolve_identifier(file, e, name, true)
            .unwrap_or(None)
        {
            // `getSymbol`: an alias whose target is not a value is not found.
            Some(symbol) if !files.means(symbol, SymFlags::VALUE) => None,
            Some(symbol) => self
                .resolve_without_export_value(e, name, symbol)
                .map(Found::Symbol),
            None => match name {
                known::arguments if bound.is_arguments_object(e) => {
                    Some(Found::Undeclared(Undeclared::Name(name)))
                }
                // `RequireSymbol`
                known::require
                    if hir.is_js
                        && matches!(bound.expr_parent[e.idx()], Parent::Expr(call) if call.is_some() && crate::bind::require_argument(hir, call).is_some()) =>
                {
                    Some(Found::Undeclared(Undeclared::Name(name)))
                }
                _ => None,
            },
        }
    }

    /// `getPropertyOfType`
    fn get_property_of_type(&mut self, ty: TypeId, name: Atom) -> Option<Found<'p>> {
        // `getReducedApparentType`
        let ty = self.c.reduced_apparent_type(ty);
        if !matches!(self.c.data(ty), TypeData::Union(_)) {
            let members = self.c.members(ty)?;
            // `typeOnlyExportStarMap`: a member that a module has through `export type *` is listed
            // but cannot be looked up.
            if members.shape().prop(name).is_some() && self.c.prop_ref(ty, name).is_none() {
                return None;
            }
            let (prop, mapper) = self.c.property_in_type(ty, &members, name)?;
            // `bindClassLikeDeclaration`
            if name == known::prototype
                && matches!(prop.source, PropSource::Type(_))
                && let TypeData::Anon {
                    origin: Origin::ClassStatic(class),
                    ..
                } = *self.c.data(ty)
            {
                return Some(Found::Prototype(class));
            }
            if name == known::default && matches!(prop.source, PropSource::Type(_)) {
                let module = match self.c.data(ty) {
                    TypeData::Synth(shape) => shape.default_of,
                    TypeData::Anon {
                        origin:
                            Origin::Namespace {
                                originating_import, ..
                            },
                        ..
                    } => {
                        // `resolveESModuleSymbol`: `moduleSymbol`, not its `export =` target.
                        let (files, at) = (self.c.files(), originating_import.file);
                        let declarations = &files.symbol(*originating_import).decls;
                        declarations.iter().find_map(|decl| match *decl {
                            Decl::ImportNamespace(import) => {
                                let import = &self.c.hir(at)[import];
                                let mode = files.mode_of_import(at, import.mode);
                                files.module_of_specifier_as(at, import.spec, mode)
                            }
                            _ => None,
                        })
                    }
                    _ => None,
                };
                if let Some(module) = module {
                    return Some(Found::SyntheticDefault(module));
                }
            }
            return Some(Found::Property(FoundProp::Of(prop), mapper));
        }
        let (prop, mapper) = self.c.get_property_of_type(ty, name)?;
        Some(match &prop.source {
            PropSource::Intersected(..) => Found::Properties(prop, mapper),
            _ => Found::Property(FoundProp::Of(prop), mapper),
        })
    }

    /// `getApplicableIndexSymbol`, for the key `name`.
    fn get_applicable_index_symbol(&mut self, ty: TypeId, name: Atom) -> Option<Found<'p>> {
        // `getIndexInfosOfType`: `getReducedApparentType`. An index info created by
        // `getUnionIndexInfos` has no declaration.
        let apparent = self.c.reduced_apparent_type(ty);
        if self.c.is_union(apparent) {
            return None;
        }
        let members = self.c.members(apparent)?;
        let info = self.c.applicable_index_info_for_name(&members, name)?;
        let mut declarations = Vec::new();
        match info.declaration {
            Some(declaration) => declarations.push(declaration),
            None => {
                let key_type = if self.c.atoms().is_symbol_name(name) {
                    TypeId::SYMBOL
                } else {
                    self.c.string_literal(name, false)
                };
                for info in &members.shape().index {
                    if let Some(declaration) = info.declaration
                        && self.c.is_applicable_index_type(key_type, info.key)
                    {
                        declarations.push(declaration);
                    }
                }
            }
        }
        if declarations.is_empty() {
            return None;
        }
        // `t.symbol`
        let parent = match *self.c.data(ty) {
            TypeData::Ref { target, .. } | TypeData::ThisParam(target) => Some(target),
            TypeData::Anon {
                origin: Origin::ClassStatic(class),
                ..
            } => Some(class),
            TypeData::TypeParam(file, parameter, _) => {
                let symbol = self.c.bound(file).type_param_symbol[parameter.idx()];
                symbol.is_some().then(|| self.c.files().sym(file, symbol))
            }
            // `getRestType`: the symbol of the binding element.
            TypeData::Synth(ref shape) => shape.symbol_declared_at.and_then(|(of, pos, _)| {
                let mut pats = self.c.hir(of).pats.iter();
                let pat =
                    pats.position(|it| it.pos == pos && matches!(it.kind, PatKind::Ident(_)))?;
                let symbol = self.c.bound(of).pat_symbol[pat];
                symbol.is_some().then(|| self.c.files().sym(of, symbol))
            }),
            _ => None,
        };
        Some(Found::IndexSignature {
            of: apparent,
            parent,
            declarations,
        })
    }

    /// `t.symbol`
    fn symbol_of_type(&self, ty: TypeId) -> Option<Found<'p>> {
        let files = self.c.files();
        Some(match *self.c.data(ty) {
            TypeData::ThisParam(symbol) | TypeData::Enum { symbol, .. } => Found::Symbol(symbol),
            TypeData::Ref { target, .. } => Found::Symbol(target),
            TypeData::EnumLit { member, .. } => Found::Symbol(member),
            TypeData::TypeParam(file, parameter, _) => {
                let symbol = self.c.bound(file).type_param_symbol[parameter.idx()];
                if symbol.is_none() {
                    return None;
                }
                Found::Symbol(files.sym(file, symbol))
            }
            TypeData::Anon { origin, .. } => match origin {
                Origin::ClassStatic(symbol)
                | Origin::Function(symbol)
                | Origin::EnumObject(symbol)
                | Origin::Module(symbol) => Found::Symbol(symbol),
                Origin::Namespace { module, .. } => Found::Symbol(module),
                Origin::ObjectLiteral(file, e, ..) | Origin::WidenedLiteral(file, e, ..) => {
                    Found::Anonymous {
                        file,
                        declaration: Declaration::Expression(e),
                    }
                }
                Origin::TypeLiteral(file, node) | Origin::Mapped(file, node) => Found::Anonymous {
                    file,
                    declaration: Declaration::TypeNode(node),
                },
                Origin::GlobalThis => Found::Undeclared(Undeclared::GlobalThis),
            },
            // A function expression or an arrow function.
            TypeData::Fns { ref decls, .. } => {
                let &(file, function) = decls.first()?;
                let bound = self.c.bound(file);
                let symbol = bound.fn_symbol[function.idx()];
                if symbol.is_some() && self.c.hir(file)[function].name.is_some() {
                    return Some(Found::Symbol(files.sym(file, symbol)));
                }
                match bound.fns[function.idx()].owner {
                    FnOwner::Expr(e) => Found::Anonymous {
                        file,
                        declaration: Declaration::Expression(e),
                    },
                    // `() => T`, `new () => T`
                    FnOwner::Type(node) => Found::Anonymous {
                        file,
                        declaration: Declaration::TypeNode(node),
                    },
                    _ => return None,
                }
            }
            _ => return None,
        })
    }
}

/// Whether the source has a `#x` or a number at `pos`, where the HIR stores no name.
fn is_literal_name_at(hir: &hir::File, pos: u32) -> bool {
    matches!(hir.text.get(pos as usize), Some(b'#' | b'0'..=b'9'))
}

impl<'c, 'p, 's> Services<'c, 'p, 's> {
    fn symbol_found(&mut self, found: Found<'p>) -> SymbolRef {
        match found {
            Found::Symbol(symbol) => self.symbol(symbol),
            Found::Property(FoundProp::Of(prop), mapper) | Found::Properties(prop, mapper) => {
                self.symbol_of_prop(prop, mapper)
            }
            // What is made up for a declared member says nothing but which symbol it is.
            Found::Property(FoundProp::Made(prop), mapper) => match prop.source {
                PropSource::Symbol(symbol) => {
                    let symbol = self.c.files().canonical(symbol);
                    self.named_symbol(Key::Symbol(symbol), prop.name)
                }
                PropSource::Literal(file, p) => {
                    let prop: &'c Prop<'c> = self.arena.alloc(prop);
                    self.intern_symbol(Key::LiteralMember(file, p), Some((prop, mapper)))
                }
                _ => {
                    let prop: &'c Prop<'c> = self.arena.alloc(prop);
                    self.symbol_of_prop(prop, mapper)
                }
            },
            Found::Anonymous { file, declaration } => {
                let hir = self.c.hir(file);
                let key = match declaration {
                    Declaration::Bound(decl) => Key::Anonymous(file, hir.node(decl)),
                    Declaration::Expression(e) => Key::Anonymous(file, hir.node(e)),
                    Declaration::TypeNode(node) => Key::Anonymous(file, hir.node(node)),
                    Declaration::ThisParameter(function) => Key::ThisParameter(file, function),
                };
                self.intern_symbol(key, None)
            }
            Found::Undeclared(undeclared) => {
                let atoms = self.c.atoms();
                let name = match undeclared {
                    Undeclared::Name(name) => name,
                    Undeclared::Path(names) => {
                        let last = names.last().copied().unwrap_or(Atom::NONE);
                        let names: Vec<&[u8]> =
                            names.iter().map(|&name| atoms.bytes(name)).collect();
                        let path = atoms.intern(&names.join(&b"."[..]));
                        return self.named_symbol(Key::Undeclared(path), last);
                    }
                    Undeclared::Const => {
                        let name = atoms.intern(b"const");
                        return self.named_symbol(Key::Undeclared(name), name);
                    }
                    Undeclared::ImportMeta => atoms.intern(b"meta"),
                    Undeclared::GlobalThis => {
                        return self.symbol(self.c.files().global_this_symbol);
                    }
                };
                self.intern_symbol(Key::Undeclared(name), None)
            }
            Found::Prototype(class) => self.intern_symbol(Key::Prototype(class), None),
            Found::SyntheticDefault(module) => {
                self.intern_symbol(Key::SyntheticDefault(module), None)
            }
            Found::IndexSignature {
                of, declarations, ..
            } => match declarations[..] {
                [declaration] => self.intern_symbol(Key::Index(of, declaration), None),
                _ => self.unique_symbol(),
            },
        }
    }

    /// `type.symbol`
    pub fn symbol_of_type(&mut self, ty: TypeId) -> Option<SymbolRef> {
        // The declared type of an enum with several members is a union that has the symbol of the
        // enum.
        if self.c.flags(ty) & (tf::UNION | tf::ENUM_LITERAL) == tf::UNION | tf::ENUM_LITERAL
            && let Some(symbol) = self.c.alias_symbol_of_type(ty)
        {
            return Some(self.symbol(symbol));
        }
        if let TypeData::UniqueSymbol { symbol, name } = *self.c.data(ty) {
            return match symbol {
                UniqueSymbolDeclaration::Variable(symbol) => Some(self.symbol(symbol)),
                UniqueSymbolDeclaration::Member(file, member) => {
                    let symbol = self.c.symbol_of_member(file, member);
                    Some(self.symbol(symbol))
                }
                // `Symbol.iterator`: the property of the global `SymbolConstructor`.
                UniqueSymbolDeclaration::SymbolConstructor => {
                    let atoms = self.c.atoms();
                    let written = atoms
                        .bytes(name)
                        .strip_prefix(crate::atom::SYMBOL_NAME_PREFIX)?;
                    let (written, constructor) =
                        (atoms.lookup(written)?, atoms.lookup(b"SymbolConstructor")?);
                    let constructor = self.c.global_type_symbol(constructor)?;
                    let constructor = self.c.declared_type(constructor);
                    let (prop, mapper) = self.c.get_property_of_type(constructor, written)?;
                    Some(self.symbol_of_prop(prop, mapper))
                }
            };
        }
        use super::super::errors_small::SymbolAtLocation;
        let key = match self.c.symbol_of_type(ty)? {
            SymbolAtLocation::Symbol(symbol) => return Some(self.symbol(symbol)),
            // The type of a method has the symbol of the method.
            SymbolAtLocation::Anonymous(file, node) => match self.c.hir(file).data(node) {
                NodeData::Member(member) => {
                    let symbol = self.c.symbol_of_member(file, member);
                    let name = self
                        .c
                        .declared_member_name(file, self.c.hir(file)[member].key);
                    let symbol = self.c.files().canonical(symbol);
                    return Some(
                        self.named_symbol(Key::Symbol(symbol), name.unwrap_or(Atom::NONE)),
                    );
                }
                NodeData::Prop(p) => {
                    let prop: &'c Prop<'c> = self.arena.alloc(Prop {
                        name: self.c.hir(file)[p].key.name().unwrap_or(Atom::NONE),
                        flags: PropFlags::empty(),
                        source: PropSource::Literal(file, p),
                        mapper: MapperId::IDENTITY,
                    });
                    return Some(self.intern_symbol(
                        Key::LiteralMember(file, p),
                        Some((prop, MapperId::IDENTITY)),
                    ));
                }
                _ => Key::Anonymous(file, node),
            },
            _ => return None,
        };
        Some(self.intern_symbol(key, None))
    }

    /// `getSymbolAtLocation`
    pub fn symbol_at_location(&mut self, node: NodeRef) -> Option<SymbolRef> {
        let (hir, at) = self.valid(node)?;
        let (file, files) = (node.file, self.c.files());
        if at == Node::FILE {
            return files
                .module(file)
                .is_module()
                .then(|| self.symbol(files.file_symbol(file)));
        }
        let start = hir.start(at);
        if hir.is_in_with(start) || hir.is_in_jsdoc(start) {
            return None;
        }
        // The specifier of an import or an export: the module.
        if at.part() == Some(Part::Specifier) {
            let specifier = Some(hir.text(at)).filter(|text| text.is_some())?;
            let module = files.module_of_specifier(file, specifier)?;
            return Some(self.symbol(module));
        }
        // The literal in `T["name"]`: the property.
        if at.part() == Some(Part::Literal)
            && let NodeData::Type(literal) = hir.data(at.row())
            && let NodeData::Type(access) = hir.data(hir.parent(at.row()))
            && let TypeNodeKind::IndexedAccess { obj, index } = hir[access].kind
            && index == literal
        {
            let name = match hir[literal].kind {
                TypeNodeKind::StringLit(text) => text,
                TypeNodeKind::NumberLit(number) => {
                    self.c.number_name(*hir.numbers.get(number as usize)?)
                }
                _ => return None,
            };
            let object = self.c.type_from_node(file, obj);
            let (prop, mapper) = self.c.get_property_of_type(object, name)?;
            return Some(self.symbol_of_prop(prop, mapper));
        }
        // `getTypeFromThisTypeNode(node).symbol`
        if hir.kind(at) == Kind::ThisType {
            let ty = self.type_from_type_node(node);
            return self.symbol_of_type(ty);
        }
        let kind = self.visited_kind(node)?;
        let found = SymbolFinder { c: self.c, file }.get_symbol_at_visited_node(kind)?;
        Some(self.symbol_found(found))
    }

    pub fn shorthand_assignment_value_symbol(&mut self, node: NodeRef) -> Option<SymbolRef> {
        let (hir, at) = self.valid(node)?;
        let NodeData::Prop(p) = hir.data(at) else {
            return None;
        };
        if hir[p].kind != PropKind::Shorthand {
            return None;
        }
        let value = match hir[hir[p].value].kind {
            ExprKind::Assign { target, .. } => target,
            _ => hir[p].value,
        };
        let ExprKind::Ident(name) = hir[value].kind else {
            return None;
        };
        let symbol = self
            .c
            .resolve_identifier(node.file, value, name, true)
            .ok()??;
        Some(self.symbol(symbol))
    }

    pub fn resolve_name(
        &mut self,
        node: NodeRef,
        name: &[u8],
        meaning: SymbolFlags,
        exclude_globals: bool,
    ) -> Option<SymbolRef> {
        let name = self.c.atoms().lookup(name)?;
        let scope = self.scope_at(node)?;
        let files = self.c.files();
        let symbol = files.resolve_name(node.file, scope, name, SymFlags::from(meaning))?;
        if exclude_globals && files.global(name, SymFlags::from(meaning)) == Some(symbol) {
            return None;
        }
        Some(self.symbol(symbol))
    }

    /// `getSymbolsInScope(node, meaning)`. Unlike `resolveName` it looks at the flags of a symbol
    /// itself and of what it exports, never at those of the target of an alias, so an
    /// `import x = a.b` hides no `x` unless `meaning` has `ALIAS`. `arguments` is not among them.
    pub fn symbols_in_scope(&mut self, node: NodeRef, meaning: SymbolFlags) -> &'c [SymbolRef] {
        let found = self.copy_symbols_in_scope(node, meaning, None);
        let symbols: Vec<SymbolRef> = found.into_iter().map(|it| self.symbol(it)).collect();
        self.list(&symbols)
    }

    /// `getSymbolsInScope(node, meaning).find(it => it.name === name)`, without the others.
    pub fn symbol_in_scope(
        &mut self,
        node: NodeRef,
        meaning: SymbolFlags,
        name: &[u8],
    ) -> Option<SymbolRef> {
        let name = self.c.atoms().lookup(name)?;
        let found = self
            .copy_symbols_in_scope(node, meaning, Some(name))
            .pop()?;
        Some(self.symbol(found))
    }

    /// `only`: nothing but the symbol that has this name.
    fn copy_symbols_in_scope(
        &self,
        node: NodeRef,
        meaning: SymbolFlags,
        only: Option<Atom>,
    ) -> Vec<Sym> {
        let Some((hir, at)) = self.valid(node) else {
            return Vec::new();
        };
        let Some(mut scope) = self
            .scope_at(node)
            .filter(|_| !hir.is_in_with(hir.start(at)))
        else {
            return Vec::new();
        };
        let (files, bound, file) = (self.c.files(), self.c.bound(node.file), node.file);
        let meaning = SymFlags::from(meaning);
        let (mut seen, mut found) = (FxHashMap::<Atom, ()>::default(), Vec::new());
        // `copySymbol`, `symbolsToArray`
        let mut copy = |name: Atom, symbol: Sym, meaning: SymFlags| {
            // `getCombinedLocalAndExportSymbolFlags`
            let own = files.symbol(symbol);
            let exported = match own.export_symbol.is_some() {
                true => bound.symbols[own.export_symbol.idx()].flags,
                false => SymFlags::empty(),
            };
            let text = files.atoms.bytes(name);
            let is_reserved = text.first() == Some(&0xFE) || text == b"this";
            if (own.flags | exported).intersects(meaning)
                && seen.insert(name, ()).is_none()
                && !is_reserved
            {
                found.push(symbol);
            }
        };
        let (mut is_static, mut depth) = (false, 0);
        while let Some(at) = bound.scopes.get(scope.idx()) {
            // The declarations of a script are globals.
            let is_global_source_file = at.kind == ScopeKind::File && at.symbol.is_none();
            // The type parameters of a class or an interface are among its members, which a static
            // member does not see.
            let meaning_of_locals = match at.kind {
                ScopeKind::Class(_) | ScopeKind::Interface(_) if is_static => SymFlags::empty(),
                ScopeKind::Class(_) | ScopeKind::Interface(_) => meaning & SymFlags::TYPE,
                _ => meaning,
            };
            if !is_global_source_file && !meaning_of_locals.is_empty() {
                match only {
                    Some(name) => {
                        if let Some(id) = bound.lookup(at.locals, name) {
                            copy(name, Sym { file, id }, meaning_of_locals);
                        }
                    }
                    None => bound
                        .table(at.locals)
                        .iter()
                        .for_each(|&(name, id)| copy(name, Sym { file, id }, meaning_of_locals)),
                }
            }
            let meaning_of_exports = match at.kind {
                ScopeKind::File | ScopeKind::Module(_) => meaning & SymFlags::MODULE_MEMBER,
                ScopeKind::Enum(_) => meaning & SymFlags::ENUM_MEMBER,
                _ => SymFlags::empty(),
            };
            if at.symbol.is_some() && !meaning_of_exports.is_empty() {
                let container = files.sym(file, at.symbol);
                // `copyLocallyVisibleExportSymbols`
                let is_visible = |name: Atom, symbol: Sym| {
                    let is_reexport = |it: &(FileId, Decl)| {
                        matches!(it.1, Decl::ExportSpec(_) | Decl::ExportStarAs(_))
                    };
                    matches!(at.kind, ScopeKind::Enum(_))
                        || name != known::default && !files.decls_of(symbol).iter().any(is_reexport)
                };
                match only {
                    Some(name) => {
                        if let Some(symbol) = files
                            .export(container, name)
                            .filter(|&it| is_visible(name, it))
                        {
                            copy(name, symbol, meaning_of_exports);
                        }
                    }
                    None => {
                        for (name, symbol) in files
                            .each_export(container)
                            .filter(|&(name, it)| is_visible(name, it))
                        {
                            copy(name, symbol, meaning_of_exports);
                        }
                    }
                }
            }
            is_static = at.kind == ScopeKind::StaticMember;
            scope = at.parent;
            depth += 1;
            if scope.is_none() || depth > 4096 {
                break;
            }
        }
        match only {
            Some(name) => {
                if let Some(&symbol) = files.globals.get(name) {
                    copy(name, symbol, meaning);
                }
            }
            None => files
                .globals
                .iter()
                .for_each(|&(name, symbol)| copy(name, symbol, meaning)),
        }
        found
    }
}

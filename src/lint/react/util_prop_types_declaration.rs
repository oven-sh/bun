#![allow(dead_code)] // until every rule of the plugin is written
//! `lib/util/propTypes.js` of eslint-plugin-react: what reads a declaration of prop types, be it
//! made of calls of `PropTypes` or a type of TypeScript. The listeners are in `util_prop_types`.
//!
//! | upstream | here |
//! |---|---|
//! | `genericReactTypesImport`, `localToImportedMap` | [`ReactTypeImports`] |
//! | `allowedGenericTypes.has(name)` | `generic_type_param_index_where_props_are_present(name).is_some()` |
//! | `getLeftMostTypeName`, `getRightMostTypeName` | `EntityName::first`, `EntityName::last` |
//! | `new DeclarePropTypesForTSTypeAnnotation(..)` | [`declare_prop_types_for_ts_type_annotation`] |
//! | `iterateProperties(context, properties, fn)` | a loop with `get_key_value` |
//! | a key that is `undefined` | `None`. The property that it names is called `undefined` |
//!
//! What only the nodes of Flow and the trees of typescript-eslint-parser 20 get to is left out.
//! Where upstream throws a `TypeError`, nothing is declared.

use crate::util_ast::{find_return_statement, get_key_value, get_property_name, name_of_key};
use crate::util_components_list::{Children, DeclaredPropType, DeclaredPropTypes, PropTypeKind};
use crate::util_props::is_required_prop_type;
use bun_lint::prelude::*;
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;
use std::borrow::Cow;

/// How far a declaration is followed into what it is made of.
const MAX_DEPTH: u32 = 100;

/// How many parts of a declaration are looked at. One that is named twice counts twice.
const MAX_STEPS: u32 = 100_000;

/// What upstream throws where that has no end: `const a = PropTypes.arrayOf(a)`.
pub(crate) struct RangeError;

/// What `object[undefined] = ..` calls the property.
pub(crate) const UNDEFINED: &[u8] = b"undefined";

const ANY_KEY: &[u8] = b"__ANY_KEY__";

/// `genericTypeParamIndexWherePropsArePresent[name]`. Its keys are `allowedGenericTypes`.
fn generic_type_param_index_where_props_are_present(name: &[u8]) -> Option<usize> {
    match name {
        b"ForwardRefRenderFunction" | b"forwardRef" => Some(1),
        b"ComponentProps"
        | b"ComponentPropsWithRef"
        | b"ComponentPropsWithoutRef"
        | b"VoidFunctionComponent"
        | b"VFC"
        | b"PropsWithChildren"
        | b"SFC"
        | b"StatelessComponent"
        | b"FunctionComponent"
        | b"FC" => Some(0),
        _ => None,
    }
}

/// `genericReactTypesImport` and `localToImportedMap`: what the imports of `react` that the walk
/// has got to call the module and its generic types.
#[derive(Default)]
pub(crate) struct ReactTypeImports<'a> {
    /// By the local name. `Some`: the name in `react`.
    locals: FxHashMap<&'a [u8], Option<&'a [u8]>>,
}

impl<'a> ReactTypeImports<'a> {
    /// `ImportDeclaration(node)`
    pub(crate) fn add(&mut self, import: Import<'a>) {
        if !import.spec().is("react") {
            return;
        }
        for local in import.default().into_iter().chain(import.namespace()) {
            self.locals.entry(local.bytes()).or_default();
        }
        for specifier in import.named() {
            let imported = specifier.imported();
            let is_allowed =
                generic_type_param_index_where_props_are_present(imported.bytes()).is_some();
            if is_allowed && !imported.is_string() {
                let local = specifier.local().bytes();
                self.locals.insert(local, Some(imported.bytes()));
            }
        }
    }

    /// `genericReactTypesImport.has(local)`
    pub(crate) fn has(&self, local: &[u8]) -> bool {
        self.locals.contains_key(local)
    }

    /// `localToImportedMap[local]`
    fn imported(&self, local: &[u8]) -> Option<&'a [u8]> {
        self.locals.get(local).copied().flatten()
    }
}

/// `key`, which is `getKeyValue(context, property)`, as `[.., key].join(".")` has it: `undefined`
/// and `null` are nothing there.
pub(crate) fn key_in_full_name<'k>(property: Prop<'_>, key: Option<&'k [u8]>) -> &'k [u8] {
    let is_null = match property.key().map(Key::kind) {
        Some(KeyKind::Computed(it)) => it.tag() == ExprTag::Null,
        _ => false,
    };
    key.filter(|_| !is_null).unwrap_or_default()
}

/// What `buildReactDeclarationTypes` closes over.
struct ReactDeclarationTypes<'a, 'b> {
    root_node: Option<Node<'a>>,
    custom_validators: &'b [Box<[u8]>],
    /// How often `build` is called.
    steps: u32,
    /// It has got to [`MAX_DEPTH`] or [`MAX_STEPS`]: nothing more is looked at.
    has_given_up: bool,
}

impl<'a> ReactDeclarationTypes<'a, '_> {
    /// `hasCustomValidator`
    fn has_custom_validator(&self, validator: Name<'_>) -> bool {
        self.custom_validators
            .iter()
            .any(|it| validator.bytes() == &**it)
    }

    /// `resolveValueForIdentifierNode`, whose callback is `*node = new_value`. Whether that is
    /// called.
    fn resolve_value_for_identifier_node(&self, node: &mut Option<Expr<'a>>) -> bool {
        let (Some(root_node), Some(name)) = (self.root_node, node.and_then(Expr::as_ident)) else {
            return false;
        };
        let ident_variable = root_node.scope().variable_scope().get_name(name);
        // `arguments` has no definition.
        let Some(definition) = ident_variable.and_then(|it| it.declarations().next_back()) else {
            return false;
        };
        *node = match definition.node() {
            Some(Node::VarDecl(it)) => it.init(),
            _ => None,
        };
        true
    }

    /// `buildReactDeclarationTypes`
    fn build(
        &mut self,
        mut value: Option<Expr<'a>>,
        parent_name: &[u8],
        depth: u32,
    ) -> DeclaredPropType<'a> {
        self.steps += 1;
        self.has_given_up |= depth > MAX_DEPTH || self.steps > MAX_STEPS;
        if self.has_given_up {
            return DeclaredPropType::default();
        }
        let object_of_callee = value
            .filter(|it| !it.is_chain_root())
            .and_then(Expr::callee)
            .filter(|it| !it.is_chain_root())
            .and_then(Expr::object)
            .and_then(Expr::as_ident);
        if object_of_callee.is_some_and(|it| self.has_custom_validator(it)) {
            return DeclaredPropType::default();
        }

        let ident_node_resolved = self.resolve_value_for_identifier_node(&mut value);
        if let Some(e) = value
            && is_required_prop_type(e)
        {
            value = e.object();
        }
        if !ident_node_resolved {
            self.resolve_value_for_identifier_node(&mut value);
        }

        let Some(call) = value
            .filter(|it| !it.is_chain_root())
            .and_then(Expr::as_call)
        else {
            return DeclaredPropType::default();
        };
        let callee = call.callee();
        let call_name = get_property_name(Node::Expr(callee)).filter(|_| !callee.is_chain_root());
        let (Some(call_name), Some(argument)) = (call_name, call.args().first()) else {
            return DeclaredPropType::default();
        };
        match call_name {
            b"shape" | b"exact" => {
                let ExprKind::Object(properties) = argument.kind() else {
                    return DeclaredPropType::default();
                };
                let mut children = DeclaredPropTypes::default();
                for prop_node in properties {
                    // A spread has no `value`.
                    let is_spread = prop_node.kind() == PropKind::Spread;
                    let Some(child_value) = prop_node.value().filter(|_| !is_spread) else {
                        continue;
                    };
                    let child_key = get_key_value(Node::Prop(prop_node));
                    let joined_key = key_in_full_name(prop_node, child_key.as_deref());
                    let full_name = [parent_name, b".", joined_key].concat();
                    let built = self.build(Some(child_value), &full_name, depth + 1);
                    let types = DeclaredPropType {
                        full_name: Some(Cow::Owned(full_name)),
                        name: child_key.clone(),
                        node: Some(Node::Prop(prop_node)),
                        ..built
                    };
                    children.insert(child_key.unwrap_or(Cow::Borrowed(UNDEFINED)), types);
                }
                let kind = match call_name {
                    b"shape" => PropTypeKind::Shape,
                    _ => PropTypeKind::Exact,
                };
                DeclaredPropType {
                    kind: Some(kind),
                    children: Children::Named(children),
                    ..DeclaredPropType::default()
                }
            }
            b"arrayOf" | b"objectOf" => {
                let full_name = [parent_name, b".*"].concat();
                let built = self.build(Some(argument), &full_name, depth + 1);
                let child = DeclaredPropType {
                    full_name: Some(Cow::Owned(full_name)),
                    name: Some(Cow::Borrowed(ANY_KEY)),
                    node: Some(Node::Expr(argument)),
                    ..built
                };
                let mut children = DeclaredPropTypes::default();
                children.insert(Cow::Borrowed(ANY_KEY), child);
                DeclaredPropType {
                    kind: Some(PropTypeKind::Object),
                    children: Children::Named(children),
                    ..DeclaredPropType::default()
                }
            }
            b"oneOfType" => match argument.kind() {
                ExprKind::Array(elements) if !elements.is_empty() => {
                    let children = elements
                        .iter()
                        .map(|element| self.build(Some(element), parent_name, depth + 1));
                    DeclaredPropType {
                        kind: Some(PropTypeKind::Union),
                        children: Children::Union(children.collect()),
                        ..DeclaredPropType::default()
                    }
                }
                _ => DeclaredPropType::default(),
            },
            _ => DeclaredPropType::default(),
        }
    }
}

/// `buildReactDeclarationTypes`. A `parent_name` that is `undefined` or `null` is empty. The
/// listeners for a `FunctionDeclaration` and an `ArrowFunctionExpression` have no `root_node`.
pub(crate) fn build_react_declaration_types<'a>(
    value: Option<Expr<'a>>,
    parent_name: &[u8],
    root_node: Option<Node<'a>>,
    custom_validators: &[Box<[u8]>],
) -> Result<DeclaredPropType<'a>, RangeError> {
    let mut types = ReactDeclarationTypes {
        root_node,
        custom_validators,
        steps: 0,
        has_given_up: false,
    };
    let built = types.build(value, parent_name, 0);
    match types.has_given_up {
        true => Err(RangeError),
        false => Ok(built),
    }
}

/// `isValidReactGenericTypeAnnotation`
pub(crate) fn is_valid_react_generic_type_annotation(
    annotation: TypeNode<'_>,
    imports: &ReactTypeImports<'_>,
) -> bool {
    let TypeKind::Ref {
        name: type_name, ..
    } = annotation.kind()
    else {
        return true;
    };
    match (type_name.first(), type_name.last(), type_name.len()) {
        (Some(name), _, 1) => imports.has(name.bytes()),
        (Some(left), Some(right), 2) => {
            imports.has(left.bytes())
                && generic_type_param_index_where_props_are_present(right.bytes()).is_some()
        }
        // The `left` of `A.B.C` is a `TSQualifiedName`, which has no `name`.
        _ => false,
    }
}

/// `tsInterfaceBody.key[accessor]`: the `name` of an identifier, the `raw` of a number, the
/// `value` of any other literal.
fn key_of_signature(ts_interface_body: Member<'_>) -> Option<Cow<'_, [u8]>> {
    let (file, key) = (ts_interface_body.file(), ts_interface_body.key());
    let number = match key.map(Key::kind) {
        Some(KeyKind::Number(_) | KeyKind::ComputedNumber(_)) => {
            key.map(|it| file.slice(it.inner_span(file)))
        }
        Some(KeyKind::Computed(e)) if e.tag() == ExprTag::Number => Some(e.text()),
        Some(KeyKind::Private(_)) => return key.and_then(name_of_key).map(Cow::Borrowed),
        _ => None,
    };
    // A `bigint` is no number.
    match number.filter(|raw| !raw.ends_with(b"n")) {
        Some(raw) => Some(Cow::Borrowed(raw)),
        None => get_key_value(Node::Member(ts_interface_body)),
    }
}

/// The `VariableDeclaration`s of `sourceCode.ast.body` with a declarator whose `id.name` is
/// `name`. `None`: `undefined`, which is the `name` of a pattern.
fn variable_declarations<'a>(
    file: &'a File<'a>,
    name: Option<Name<'a>>,
) -> SmallVec<[Stmt<'a>; 1]> {
    let is_in_body = |it: Stmt<'a>| matches!(it.parent(), Node::File(_)) && !it.is_exported();
    let Some(name) = name else {
        let declares_pattern = |it: &Stmt<'a>| match it.kind() {
            StmtKind::Var(declarations) => {
                is_in_body(*it)
                    && declarations
                        .iter()
                        .any(|dec| dec.pat().as_ident().is_none())
            }
            _ => false,
        };
        return file.body().iter().filter(declares_pattern).collect();
    };
    // What the top level declares is in that scope, with the `var`s of the blocks in it.
    let variable = file.top_level_scope().get_name(name);
    let mut found: SmallVec<[Stmt<'a>; 1]> = SmallVec::new();
    for definition in variable.into_iter().flat_map(Symbol::declarations) {
        if let Some(Node::VarDecl(dec)) = definition.node()
            && dec.pat().as_ident() == Some(name)
            && let Node::Stmt(statement) = dec.parent()
            && statement.tag() == StmtTag::Var
            && is_in_body(statement)
            && found.last() != Some(&statement)
        {
            found.push(statement);
        }
    }
    found
}

/// `class DeclarePropTypesForTSTypeAnnotation`
struct DeclarePropTypesForTsTypeAnnotation<'a, 'b> {
    declared_prop_types: DeclaredPropTypes<'a>,
    found_declared_properties_list: Vec<Member<'a>>,
    reference_name_map: FxHashSet<Name<'a>>,
    should_ignore_prop_types: bool,
    should_specify_optional_children_props: bool,
    should_specify_class_name_prop: bool,
    root_node: Option<Node<'a>>,
    imports: &'b ReactTypeImports<'a>,
    custom_validators: &'b [Box<[u8]>],
    /// How many calls of `visit_ts_node` are under way.
    depth: u32,
    /// How often it is called.
    steps: u32,
    /// It has got to [`MAX_DEPTH`] or [`MAX_STEPS`]: nothing more is looked at.
    has_given_up: bool,
}

impl<'a> DeclarePropTypesForTsTypeAnnotation<'a, '_> {
    /// `visitTSNode`. A `TSTypeAnnotation` is no node, nor is a `TSTypeParameterInstantiation`:
    /// [`Self::visit_type_arguments`].
    fn visit_ts_node(&mut self, node: Option<TypeNode<'a>>) {
        let Some(node) = node else {
            return;
        };
        self.steps += 1;
        self.has_given_up |= self.depth == MAX_DEPTH || self.steps > MAX_STEPS;
        if self.has_given_up {
            self.should_ignore_prop_types = true;
            return;
        }
        self.depth += 1;
        match node.kind() {
            TypeKind::Ref { name, args } => self.search_declaration_by_name(node, name, args),
            TypeKind::Object(members) => self.found_declared_properties_list.extend(members),
            TypeKind::Intersection(types) => self.convert_intersection_type_to_prop_types(types),
            _ => self.should_ignore_prop_types = true,
        }
        self.depth -= 1;
    }

    /// `this.visitTSNode(propsUtil.getTypeArguments(call))`, or if there are none
    /// `this.shouldIgnorePropTypes = true`. Whether there are.
    fn visit_type_arguments(&mut self, call: Call<'a>) -> bool {
        let params = call.type_args();
        for x in params {
            self.visit_ts_node(Some(x));
        }
        self.should_ignore_prop_types |= params.is_empty();
        !params.is_empty()
    }

    /// `searchDeclarationByName`, for a `TSTypeReference` or a `TSInterfaceHeritage`.
    fn search_declaration_by_name(
        &mut self,
        node: TypeNode<'a>,
        name: EntityName<'a>,
        node_type_arguments: List<'a, TypeNode<'a>>,
    ) {
        let is_ts_interface_heritage =
            matches!(node.parent(), Node::Stmt(it) if it.tag() == StmtTag::Interface);
        if !is_ts_interface_heritage
            && let (Some(left_most_name), Some(right_most_name)) = (name.first(), name.last())
            && self.imports.has(left_most_name.bytes())
            && !node_type_arguments.is_empty()
        {
            let (left_most_name, right_most_name) = (left_most_name.name(), right_most_name.name());
            self.should_specify_optional_children_props = true;
            if left_most_name.is("React")
                && right_most_name.is_any(&["HTMLAttributes", "HTMLElement", "HTMLProps"])
            {
                self.should_specify_class_name_prop = true;
            }
            let generic_type = match left_most_name != right_most_name {
                true => Some(right_most_name.bytes()),
                false => self.imports.imported(right_most_name.bytes()),
            };
            let idx = generic_type.and_then(generic_type_param_index_where_props_are_present);
            self.visit_ts_node(idx.and_then(|idx| node_type_arguments.get(idx)));
            return;
        }
        // `A.B` has no `name`, as a type and as an expression.
        let Some(type_name) = name.as_ident().map(Ident::name) else {
            self.should_ignore_prop_types = true;
            return;
        };
        if type_name.is("ReturnType") {
            self.convert_return_type_to_prop_types(node.file(), node_type_arguments);
            return;
        }
        if !self.reference_name_map.insert(type_name) {
            self.should_ignore_prop_types = true;
            return;
        }
        // The interfaces and type aliases of `sourceCode.ast.body` are what that scope has.
        let variable = node.file().top_level_scope().get_name(type_name);
        let mut is_declared = false;
        for declaration in variable.into_iter().flat_map(Symbol::declarations) {
            let is_interface_or_type_alias = match declaration {
                // An `ExportDefaultDeclaration` is not looked into.
                Declaration::Interface(it) => !it.stmt().is_default_export(),
                Declaration::TypeAlias(_) => true,
                _ => false,
            };
            if is_interface_or_type_alias {
                is_declared = true;
                self.traverse_declared_interface_or_type_alias(declaration);
            }
        }
        self.should_ignore_prop_types |= !is_declared;
    }

    /// `traverseDeclaredInterfaceOrTypeAlias`
    fn traverse_declared_interface_or_type_alias(&mut self, node: Declaration<'a>) {
        match node {
            Declaration::Interface(it) => {
                self.found_declared_properties_list.extend(it.members());
                for x in it.extends() {
                    self.visit_ts_node(Some(x));
                }
            }
            Declaration::TypeAlias(it) => self.visit_ts_node(Some(it.ty())),
            _ => {}
        }
    }

    /// `convertIntersectionTypeToPropTypes`
    fn convert_intersection_type_to_prop_types(&mut self, types: List<'a, TypeNode<'a>>) {
        for x in types {
            self.visit_ts_node(Some(x));
        }
    }

    /// `convertReturnTypeToPropTypes`
    fn convert_return_type_to_prop_types(
        &mut self,
        file: &'a File<'a>,
        node_type_arguments: List<'a, TypeNode<'a>>,
    ) {
        let return_type = node_type_arguments.first();
        let return_type = return_type.filter(|_| node_type_arguments.len() == 1);
        let expr_name = match return_type.map(TypeNode::kind) {
            Some(TypeKind::Typeof { expr, .. }) => expr.as_ident(),
            Some(TypeKind::Import {
                is_typeof: true, ..
            }) => None,
            Some(TypeKind::Fn(it))
                if it.kind() == FnKind::FunctionType && it.return_type().is_some() =>
            {
                self.visit_ts_node(it.return_type());
                return;
            }
            _ => {
                self.should_ignore_prop_types = true;
                return;
            }
        };
        let declarations = variable_declarations(file, expr_name);
        self.should_ignore_prop_types |= declarations.is_empty();
        for declaration in declarations {
            if let StmtKind::Var(declarators) = declaration.kind() {
                for dec in declarators {
                    self.convert_returned_value_to_prop_types(dec.init());
                }
            }
        }
    }

    /// The callback of `returnTypeFunction.forEach(..)` in `convertReturnTypeToPropTypes`.
    fn convert_returned_value_to_prop_types(&mut self, func: Option<Expr<'a>>) {
        let res = match func.and_then(Expr::as_fn).map(|it| (it, it.body())) {
            Some((_, FnBody::Expr(body))) => Some(body),
            Some((it, FnBody::Block(_))) => {
                find_return_statement(Node::Func(it)).and_then(|statement| match statement.kind() {
                    StmtKind::Return(argument) => argument,
                    _ => None,
                })
            }
            _ => None,
        };
        let Some(res) = res else {
            return;
        };
        match res.kind() {
            ExprKind::Object(properties) => {
                for prop_node in properties {
                    self.convert_returned_property_to_prop_types(prop_node);
                }
            }
            ExprKind::Call(call) if !res.is_chain_root() => {
                self.visit_type_arguments(call);
            }
            _ => {}
        }
    }

    /// The callback of `iterateProperties(..)` in `convertReturnTypeToPropTypes`.
    fn convert_returned_property_to_prop_types(&mut self, prop_node: Prop<'a>) {
        let is_spread = prop_node.kind() == PropKind::Spread;
        if is_spread
            && let Some(argument) = prop_node.value().filter(|it| !it.is_chain_root())
            && let Some(call) = argument.as_call()
            && !self.visit_type_arguments(call)
        {
            return;
        }
        let Some(value) = prop_node.value().filter(|_| !is_spread) else {
            self.should_ignore_prop_types = true;
            return;
        };
        let key = get_key_value(Node::Prop(prop_node));
        let Ok(built) = build_react_declaration_types(
            Some(value),
            key_in_full_name(prop_node, key.as_deref()),
            self.root_node,
            self.custom_validators,
        ) else {
            self.should_ignore_prop_types = true;
            return;
        };
        let types = DeclaredPropType {
            full_name: key.clone(),
            name: key.clone(),
            node: Some(Node::Prop(prop_node)),
            is_required: Some(is_required_prop_type(value)),
            ..built
        };
        self.declared_prop_types
            .insert(key.unwrap_or(Cow::Borrowed(UNDEFINED)), types);
    }

    /// `this.declaredPropTypes[name] = { fullName: name, name, isRequired: false }`
    fn specify_optional_prop(&mut self, name: &'static [u8]) {
        let types = DeclaredPropType {
            full_name: Some(Cow::Borrowed(name)),
            name: Some(Cow::Borrowed(name)),
            is_required: Some(false),
            ..DeclaredPropType::default()
        };
        self.declared_prop_types.insert(Cow::Borrowed(name), types);
    }

    /// `endAndStructDeclaredPropTypes`
    fn end_and_struct_declared_prop_types(&mut self) {
        if self.should_specify_optional_children_props {
            self.specify_optional_prop(b"children");
        }
        if self.should_specify_class_name_prop {
            self.specify_optional_prop(b"className");
        }
        for ts_interface_body in std::mem::take(&mut self.found_declared_properties_list) {
            // Not a `TSPropertySignature` and not a `TSMethodSignature`.
            if matches!(
                ts_interface_body.kind(),
                MemberKind::CallSignature
                    | MemberKind::ConstructSignature
                    | MemberKind::IndexSignature
            ) {
                continue;
            }
            let key = key_of_signature(ts_interface_body);
            let types = DeclaredPropType {
                full_name: key.clone(),
                name: key.clone(),
                node: Some(Node::Member(ts_interface_body)),
                is_required: Some(!ts_interface_body.flags().contains(Flags::OPTIONAL)),
                ..DeclaredPropType::default()
            };
            self.declared_prop_types
                .insert(key.unwrap_or(Cow::Borrowed(UNDEFINED)), types);
        }
    }
}

/// What is read of a `DeclarePropTypesForTSTypeAnnotation`.
pub(crate) struct TsAnnotation<'a> {
    pub(crate) declared_prop_types: DeclaredPropTypes<'a>,
    pub(crate) should_ignore_prop_types: bool,
}

/// `new DeclarePropTypesForTSTypeAnnotation(propTypes, declaredPropTypes, rootNode)`. Of a
/// `TSTypeAnnotation` the type in it. `root_node`: see [`build_react_declaration_types`].
pub(crate) fn declare_prop_types_for_ts_type_annotation<'a>(
    prop_types: Option<TypeNode<'a>>,
    declared_prop_types: DeclaredPropTypes<'a>,
    root_node: Option<Node<'a>>,
    imports: &ReactTypeImports<'a>,
    custom_validators: &[Box<[u8]>],
) -> TsAnnotation<'a> {
    let mut annotation = DeclarePropTypesForTsTypeAnnotation {
        declared_prop_types,
        found_declared_properties_list: Vec::new(),
        reference_name_map: FxHashSet::default(),
        should_ignore_prop_types: false,
        should_specify_optional_children_props: false,
        should_specify_class_name_prop: false,
        root_node,
        imports,
        custom_validators,
        depth: 0,
        steps: 0,
        has_given_up: false,
    };
    annotation.visit_ts_node(prop_types);
    annotation.end_and_struct_declared_prop_types();
    TsAnnotation {
        declared_prop_types: annotation.declared_prop_types,
        should_ignore_prop_types: annotation.should_ignore_prop_types,
    }
}

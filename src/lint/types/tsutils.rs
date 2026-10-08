//! `ts-api-utils`, as far as it is about types, symbols and compiler options. The names are those
//! of the package in snake_case.
//!
//! What takes a `typeChecker` there does not here: a handle knows its checker.

use super::signature::Signature;
use super::ty::TypeList;
use super::{
    CheckFlags, CompilerOptions, IndexKind, Literal, Locate, ModifierFlags, NodeFlags, ObjectFlags,
    SymbolFlags, SyntaxKind, TsNode, TsSymbol, Type, TypeFlags, TypeStructure,
};
use crate::ast::MappedModifier;

// ───────────────────────────── flags ─────────────────────────────

/// `isTypeFlagSet(type, flag)`: of the type itself, not of the constituents of a union. For those,
/// [`utils::is_type_flag_set`](super::utils::is_type_flag_set).
#[inline]
pub fn is_type_flag_set(ty: Type, flag: TypeFlags) -> bool {
    ty.flags().intersects(flag)
}

/// `isObjectFlagSet(type, flag)`
#[inline]
pub fn is_object_flag_set(ty: Type, flag: ObjectFlags) -> bool {
    ty.object_flags().intersects(flag)
}

/// `isSymbolFlagSet(symbol, flag)`
#[inline]
pub fn is_symbol_flag_set(symbol: TsSymbol, flag: SymbolFlags) -> bool {
    symbol.flags().intersects(flag)
}

/// `isModifierFlagSet(node, flag)`
#[inline]
pub fn is_modifier_flag_set(node: TsNode, flag: ModifierFlags) -> bool {
    node.modifier_flags().intersects(flag)
}

/// `isNodeFlagSet(node, flag)`
#[inline]
pub fn is_node_flag_set(node: TsNode, flag: NodeFlags) -> bool {
    node.flags().intersects(flag)
}

/// `isTransientSymbolLinksFlagSet(symbol.links, flag)`
#[inline]
pub fn is_transient_symbol_links_flag_set(symbol: TsSymbol, flag: CheckFlags) -> bool {
    symbol.check_flags().intersects(flag)
}

// ───────────────────────────── compiler options ─────────────────────────────

/// An option that `isCompilerOptionEnabled` and `isStrictCompilerOptionEnabled` are asked about.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum CompilerOption {
    AllowJs,
    AllowSyntheticDefaultImports,
    CheckJs,
    EmitDecoratorMetadata,
    EsModuleInterop,
    ExactOptionalPropertyTypes,
    ExperimentalDecorators,
    IsolatedDeclarations,
    IsolatedModules,
    NoFallthroughCasesInSwitch,
    NoImplicitAny,
    NoImplicitOverride,
    NoImplicitReturns,
    NoImplicitThis,
    NoPropertyAccessFromIndexSignature,
    NoUncheckedIndexedAccess,
    StrictBindCallApply,
    StrictFunctionTypes,
    StrictNullChecks,
    StrictPropertyInitialization,
    UseUnknownInCatchVariables,
    VerbatimModuleSyntax,
}

/// `isCompilerOptionEnabled(options, option)`
pub fn is_compiler_option_enabled(options: CompilerOptions, option: CompilerOption) -> bool {
    use CompilerOption::*;
    match option {
        AllowJs => options.allow_js,
        AllowSyntheticDefaultImports => options.allow_synthetic_default_imports,
        CheckJs => options.check_js,
        EmitDecoratorMetadata => options.emit_decorator_metadata,
        EsModuleInterop => options.es_module_interop,
        ExactOptionalPropertyTypes => options.exact_optional_property_types,
        ExperimentalDecorators => options.experimental_decorators,
        IsolatedDeclarations => options.isolated_declarations,
        IsolatedModules => options.isolated_modules,
        NoFallthroughCasesInSwitch => options.no_fallthrough_cases_in_switch,
        NoImplicitAny => options.no_implicit_any,
        NoImplicitOverride => options.no_implicit_override,
        NoImplicitReturns => options.no_implicit_returns,
        NoImplicitThis => options.no_implicit_this,
        NoPropertyAccessFromIndexSignature => options.no_property_access_from_index_signature,
        NoUncheckedIndexedAccess => options.no_unchecked_indexed_access && options.strict_null_checks,
        StrictBindCallApply => options.strict_bind_call_apply,
        StrictFunctionTypes => options.strict_function_types,
        StrictNullChecks => options.strict_null_checks,
        StrictPropertyInitialization => options.strict_property_initialization && options.strict_null_checks,
        UseUnknownInCatchVariables => options.use_unknown_in_catch_variables,
        VerbatimModuleSyntax => options.verbatim_module_syntax,
    }
}

/// `isStrictCompilerOptionEnabled(options, option)`. [`CompilerOptions`] has what `strict` implies
/// resolved, so this is the same question.
#[inline]
pub fn is_strict_compiler_option_enabled(options: CompilerOptions, option: CompilerOption) -> bool {
    is_compiler_option_enabled(options, option)
}

// ───────────────────────────── kinds of types ─────────────────────────────

macro_rules! flag_guards {
    ($($(#[$doc:meta])* $name:ident $flags:ident;)*) => {
        $($(#[$doc])*
        #[inline]
        pub fn $name(ty: Type) -> bool {
            ty.flags().intersects(TypeFlags::$flags)
        })*
    };
}

flag_guards! {
    /// `isIntrinsicAnyType(type)`. The error type is one too.
    is_intrinsic_any_type ANY;
    /// `isIntrinsicBigIntType(type)`
    is_intrinsic_big_int_type BIG_INT;
    /// `isIntrinsicBooleanType(type)`
    is_intrinsic_boolean_type BOOLEAN;
    /// `isIntrinsicESSymbolType(type)`
    is_intrinsic_es_symbol_type ES_SYMBOL;
    /// `isIntrinsicNeverType(type)`
    is_intrinsic_never_type NEVER;
    /// `isIntrinsicNonPrimitiveType(type)`: `object`
    is_intrinsic_non_primitive_type NON_PRIMITIVE;
    /// `isIntrinsicNullType(type)`
    is_intrinsic_null_type NULL;
    /// `isIntrinsicNumberType(type)`
    is_intrinsic_number_type NUMBER;
    /// `isIntrinsicStringType(type)`
    is_intrinsic_string_type STRING;
    /// `isIntrinsicType(type)`
    is_intrinsic_type INTRINSIC;
    /// `isIntrinsicUndefinedType(type)`
    is_intrinsic_undefined_type UNDEFINED;
    /// `isIntrinsicUnknownType(type)`
    is_intrinsic_unknown_type UNKNOWN;
    /// `isIntrinsicVoidType(type)`
    is_intrinsic_void_type VOID;
    /// `isConditionalType(type)`. Its parts: [`Type::structure`].
    is_conditional_type CONDITIONAL;
    /// `isEnumType(type)`
    is_enum_type ENUM;
    /// `isFreshableType(type)`
    is_freshable_type FRESHABLE;
    /// `isIndexedAccessType(type)`. Its parts: [`Type::structure`].
    is_indexed_access_type INDEXED_ACCESS;
    /// `isIndexType(type)`: `keyof T`
    is_index_type INDEX;
    /// `isInstantiableType(type)`
    is_instantiable_type INSTANTIABLE;
    /// `isIntersectionType(type)`
    is_intersection_type INTERSECTION;
    /// `isObjectType(type)`
    is_object_type OBJECT;
    /// `isStringMappingType(type)`
    is_string_mapping_type STRING_MAPPING;
    /// `isSubstitutionType(type)`
    is_substitution_type SUBSTITUTION;
    /// `isTypeParameter(type)`
    is_type_parameter TYPE_PARAMETER;
    /// `isTypeVariable(type)`
    is_type_variable TYPE_VARIABLE;
    /// `isUnionOrIntersectionType(type)`
    is_union_or_intersection_type UNION_OR_INTERSECTION;
    /// `isUnionType(type)`
    is_union_type UNION;
    /// `isUniqueESSymbolType(type)`
    is_unique_es_symbol_type UNIQUE_ES_SYMBOL;
    /// `isBigIntLiteralType(type)`
    is_big_int_literal_type BIG_INT_LITERAL;
    /// `isBooleanLiteralType(type)`: `true` or `false`
    is_boolean_literal_type BOOLEAN_LITERAL;
    /// `isLiteralType(type)`: also `true` and `false`, unlike [`Type::is_literal`].
    is_literal_type LITERAL;
    /// `isNumberLiteralType(type)`
    is_number_literal_type NUMBER_LITERAL;
    /// `isStringLiteralType(type)`
    is_string_literal_type STRING_LITERAL;
    /// `isTemplateLiteralType(type)`
    is_template_literal_type TEMPLATE_LITERAL;
}

/// `isIntrinsicErrorType(type)`
#[inline]
pub fn is_intrinsic_error_type(ty: Type) -> bool {
    ty.is_error()
}

/// `isEvolvingArrayType(type)`
pub fn is_evolving_array_type(ty: Type) -> bool {
    is_object_type(ty) && is_object_flag_set(ty, ObjectFlags::EVOLVING_ARRAY)
}

/// `isTupleType(type)`. In TypeScript that is the target of a tuple type reference. Here a tuple
/// type is its own target, so this is the same as [`is_tuple_type_reference`].
pub fn is_tuple_type(ty: Type) -> bool {
    is_object_type(ty) && is_object_flag_set(ty, ObjectFlags::TUPLE)
}

/// `isTypeReference(type)`
pub fn is_type_reference(ty: Type) -> bool {
    is_object_type(ty) && is_object_flag_set(ty, ObjectFlags::REFERENCE)
}

/// `isTupleTypeReference(type)`
pub fn is_tuple_type_reference(ty: Type) -> bool {
    is_tuple_type(ty)
}

/// `isFreshableIntrinsicType(type)`
pub fn is_freshable_intrinsic_type(ty: Type) -> bool {
    is_intrinsic_type(ty) && is_freshable_type(ty)
}

/// `isFalseLiteralType(type)`
pub fn is_false_literal_type(ty: Type) -> bool {
    is_boolean_literal_type(ty) && ty.intrinsic_name() == Some("false")
}

/// `isTrueLiteralType(type)`
pub fn is_true_literal_type(ty: Type) -> bool {
    is_boolean_literal_type(ty) && ty.intrinsic_name() == Some("true")
}

/// `typeIsLiteral(type)`
#[inline]
pub fn type_is_literal(ty: Type) -> bool {
    ty.is_literal()
}

// ───────────────────────────── constituents ─────────────────────────────

/// `unionConstituents(type)`, `unionTypeParts(type)`: the constituents of a union, or the type
/// itself. `never` yields `never`.
#[inline]
pub fn union_constituents<'a>(ty: Type<'a>) -> TypeList<'a> {
    match is_union_type(ty) {
        true => ty.types(),
        false => TypeList::one(ty),
    }
}

/// `intersectionConstituents(type)`, `intersectionTypeParts(type)`
#[inline]
pub fn intersection_constituents<'a>(ty: Type<'a>) -> TypeList<'a> {
    match is_intersection_type(ty) {
        true => ty.types(),
        false => TypeList::one(ty),
    }
}

/// `typeConstituents(type)`, `typeParts(type)`
#[inline]
pub fn type_constituents<'a>(ty: Type<'a>) -> TypeList<'a> {
    match is_union_or_intersection_type(ty) {
        true => ty.types(),
        false => TypeList::one(ty),
    }
}

// ───────────────────────────── getters ─────────────────────────────

/// `getCallSignaturesOfType(type)`: of a union, those of all its constituents. Of an intersection,
/// those of the one constituent that has any.
pub fn get_call_signatures_of_type<'a>(ty: Type<'a>) -> Vec<Signature<'a>> {
    fn collect<'a>(ty: Type<'a>, depth: u32) -> Vec<Signature<'a>> {
        if depth > 64 {
            return Vec::new();
        }
        if is_union_type(ty) {
            return ty.types().iter().flat_map(|it| collect(it, depth + 1)).collect();
        }
        if is_intersection_type(ty) {
            let mut signatures: Option<Vec<Signature>> = None;
            for it in ty.types() {
                let found = collect(it, depth + 1);
                if !found.is_empty() {
                    if signatures.is_some() {
                        return Vec::new();
                    }
                    signatures = Some(found);
                }
            }
            return signatures.unwrap_or_default();
        }
        ty.get_call_signatures().iter().collect()
    }
    collect(ty, 0)
}

/// `getPropertyOfType(type, name)`
#[inline]
pub fn get_property_of_type<'a>(ty: Type<'a>, name: &[u8]) -> Option<TsSymbol<'a>> {
    ty.get_property(name)
}

/// `getWellKnownSymbolPropertyOfType(type, wellKnownSymbolName, typeChecker)`: the property whose
/// key is `Symbol[name]`, as in `get_well_known_symbol_property_of_type(ty, "iterator")`.
pub fn get_well_known_symbol_property_of_type<'a>(ty: Type<'a>, name: &str) -> Option<TsSymbol<'a>> {
    let mut key = Vec::with_capacity(3 + name.len());
    key.extend_from_slice(b"__@");
    key.extend_from_slice(name.as_bytes());
    ty.get_property(&key)
}

// ───────────────────────────── utilities ─────────────────────────────

/// `isFalsyType(type)`: every value of the type is falsy. Not for a union.
pub fn is_falsy_type(ty: Type) -> bool {
    if is_type_flag_set(ty, TypeFlags::UNDEFINED | TypeFlags::NULL | TypeFlags::VOID) {
        return true;
    }
    if ty.is_literal() {
        return match ty.value() {
            Some(Literal::BigInt { base10, .. }) => base10 == b"0",
            Some(Literal::String(value)) => value.is_empty(),
            Some(Literal::Number(value)) => value == 0.0 || value.is_nan(),
            None => false,
        };
    }
    is_false_literal_type(ty)
}

/// `isThenableType(typeChecker, node, type)`: it has a `then` that can be called with a callback.
pub fn is_thenable_type<'a>(node: impl Locate<'a>, ty: Type<'a>) -> bool {
    let node = node.locate(ty.file());
    for constituent in union_constituents(ty.get_apparent_type()) {
        let Some(then) = constituent.get_property(b"then") else {
            continue;
        };
        let then_type = then.get_type_at_location(node);
        for sub_constituent in union_constituents(then_type) {
            for signature in sub_constituent.get_call_signatures() {
                if let Some(first) = signature.parameters().first()
                    && is_callback(first, node)
                {
                    return true;
                }
            }
        }
    }
    false
}

/// `isThenableType(typeChecker, node)`
pub fn is_thenable<'a>(file: &'a crate::ast::File<'a>, node: impl Locate<'a>) -> bool {
    let node = node.locate(file);
    is_thenable_type(node, node.get_type_at_location())
}

fn is_callback<'a>(param: TsSymbol<'a>, node: TsNode<'a>) -> bool {
    let mut ty = param.get_type_at_location(node).get_apparent_type();
    if param.value_declaration().is_some_and(|it| it.has_dot_dot_dot_token()) {
        match ty.get_number_index_type() {
            Some(element) => ty = element,
            None => return false,
        }
    }
    union_constituents(ty).iter().any(|it| !it.get_call_signatures().is_empty())
}

/// `isNumericPropertyName(name)`: `String(+name) === name`
pub fn is_numeric_property_name(name: &[u8]) -> bool {
    let Some(number) = bun_sema::atom::parse_number(name) else {
        return matches!(name, b"NaN" | b"Infinity" | b"-Infinity");
    };
    bun_sema::atom::number_to_string(number) == name
}

/// `isPropertyReadonlyInType(type, name, typeChecker)`
pub fn is_property_readonly_in_type(ty: Type, name: &[u8]) -> bool {
    is_property_readonly_in_type_at(ty, name, 0)
}

fn is_property_readonly_in_type_at(ty: Type, name: &[u8], depth: u32) -> bool {
    if depth > 64 {
        return false;
    }
    let (mut seen_property, mut seen_readonly_signature) = (false, false);
    for sub_type in union_constituents(ty) {
        if sub_type.get_property(name).is_none() {
            let number = is_numeric_property_name(name).then(|| sub_type.get_index_info(IndexKind::Number));
            let index = number.flatten().or_else(|| sub_type.get_index_info(IndexKind::String));
            if index.is_some_and(|it| it.is_readonly()) {
                if seen_property {
                    return true;
                }
                seen_readonly_signature = true;
            }
        } else if seen_readonly_signature || is_readonly_property_intersection(sub_type, name, depth) {
            return true;
        } else {
            seen_property = true;
        }
    }
    false
}

/// `/^__@[^@]+$/`
fn is_well_known_symbol_name(name: &[u8]) -> bool {
    name.strip_prefix(b"__@").is_some_and(|rest| !rest.is_empty() && !bun_core::strings::contains_char(rest, b'@'))
}

/// `/^(?:[1-9]\d*|0)$/`
fn is_array_index(name: &[u8]) -> bool {
    match name {
        [b'0'] => true,
        [b'1'..=b'9', rest @ ..] => rest.iter().all(u8::is_ascii_digit),
        _ => false,
    }
}

fn is_readonly_property_from_mapped_type(ty: Type, name: &[u8], depth: u32) -> Option<bool> {
    let TypeStructure::Mapped { readonly, .. } = ty.structure() else {
        return None;
    };
    if readonly != MappedModifier::None && !is_well_known_symbol_name(name) {
        return Some(readonly != MappedModifier::Remove);
    }
    let modifiers_type = ty.get_modifiers_type_from_mapped_type()?;
    Some(is_property_readonly_in_type_at(modifiers_type, name, depth + 1))
}

fn is_readonly_property_intersection(ty: Type, name: &[u8], depth: u32) -> bool {
    intersection_constituents(ty).iter().any(|constituent| {
        let Some(prop) = constituent.get_property(name) else {
            return false;
        };
        if prop.has_flags(SymbolFlags::TRANSIENT) {
            if is_array_index(name)
                && let Some(target) = constituent.tuple_target()
            {
                return target.readonly();
            }
            if let Some(is_readonly) = is_readonly_property_from_mapped_type(constituent, name, depth) {
                return is_readonly;
            }
        }
        // Members of a namespace import.
        prop.has_flags(SymbolFlags::VALUE_MODULE) || symbol_has_readonly_declaration(prop)
    })
}

/// `symbolHasReadonlyDeclaration(symbol, typeChecker)`
pub fn symbol_has_readonly_declaration(symbol: TsSymbol) -> bool {
    if symbol.flags() & SymbolFlags::ACCESSOR == SymbolFlags::GET_ACCESSOR {
        return true;
    }
    symbol.declarations().any(|node| {
        if node.has_modifier(ModifierFlags::READONLY) {
            return true;
        }
        match node.kind() {
            SyntaxKind::VariableDeclaration => node.parent().is_some_and(|list| list.flags().contains(NodeFlags::CONST)),
            SyntaxKind::CallExpression => is_readonly_assignment_declaration(node),
            SyntaxKind::EnumMember => true,
            SyntaxKind::PropertyAssignment | SyntaxKind::ShorthandPropertyAssignment => is_in_const_context(node),
            _ => false,
        }
    })
}

/// `isBindableObjectDefinePropertyCall(node)`: the arguments of
/// `Object.defineProperty(entity.name, "name", descriptor)`.
fn arguments_of_define_property_call(node: TsNode<'_>) -> Option<[TsNode<'_>; 3]> {
    let callee = node.expression()?;
    if callee.kind() != SyntaxKind::PropertyAccessExpression
        || callee.name()?.text() != b"defineProperty"
        || callee.expression()?.kind() != SyntaxKind::Identifier
        || callee.expression()?.text() != b"Object"
    {
        return None;
    }
    let mut arguments = node.children().filter(|&child| child != callee);
    let found = [arguments.next()?, arguments.next()?, arguments.next()?];
    if arguments.next().is_some() {
        return None;
    }
    let is_name = matches!(
        found[1].kind(),
        SyntaxKind::StringLiteral | SyntaxKind::NumericLiteral | SyntaxKind::NoSubstitutionTemplateLiteral
    );
    (is_name && is_entity_name_expression(found[0])).then_some(found)
}

/// `isEntityNameExpression(node)`
fn is_entity_name_expression(mut node: TsNode) -> bool {
    for _ in 0..4096 {
        match node.kind() {
            SyntaxKind::Identifier => return true,
            SyntaxKind::PropertyAccessExpression if node.name().is_some_and(|it| it.kind() == SyntaxKind::Identifier) => {
                match node.expression() {
                    Some(object) => node = object,
                    None => return false,
                }
            }
            _ => return false,
        }
    }
    false
}

fn is_readonly_assignment_declaration(node: TsNode) -> bool {
    let Some([_, _, descriptor]) = arguments_of_define_property_call(node) else {
        return false;
    };
    let descriptor_type = descriptor.get_type_at_location();
    if descriptor_type.get_property(b"value").is_none() {
        return descriptor_type.get_property(b"set").is_none();
    }
    let Some(writable) = descriptor_type.get_property(b"writable") else {
        return false;
    };
    let assignment = writable.value_declaration().filter(|it| it.kind() == SyntaxKind::PropertyAssignment);
    let writable_type = match assignment.and_then(|it| it.initializer()) {
        Some(initializer) => initializer.get_type_at_location(),
        None => writable.get_type_at_location(descriptor),
    };
    is_false_literal_type(writable_type)
}

/// `isInConstContext(node, typeChecker)`
pub fn is_in_const_context(node: TsNode) -> bool {
    let mut current = node;
    for _ in 0..4096 {
        let Some(parent) = current.parent() else {
            return false;
        };
        match parent.kind() {
            SyntaxKind::ArrayLiteralExpression
            | SyntaxKind::ObjectLiteralExpression
            | SyntaxKind::ParenthesizedExpression
            | SyntaxKind::TemplateExpression => current = parent,
            SyntaxKind::AsExpression | SyntaxKind::TypeAssertionExpression => {
                // `isConstAssertionExpression`
                return parent.type_node().is_some_and(|ty| {
                    ty.kind() == SyntaxKind::TypeReference
                        && ty.children().next().is_some_and(|name| name.kind() == SyntaxKind::Identifier && name.text() == b"const")
                });
            }
            SyntaxKind::CallExpression => {
                let Some(signature) = parent.get_resolved_signature() else {
                    return false;
                };
                let callee = parent.expression();
                let arguments = parent.children().filter(|&child| Some(child) != callee && !child.kind().is_type_node());
                let mut arguments = arguments;
                let Some(index) = arguments.position(|child| child == current) else {
                    return false;
                };
                let Some(parameter) = signature.parameters().get(index) else {
                    return false;
                };
                let Some(property) = parameter.get_type().get_properties().get(index) else {
                    return false;
                };
                return property.check_flags().contains(CheckFlags::READONLY);
            }
            SyntaxKind::PrefixUnaryExpression => {
                if current.kind() != SyntaxKind::NumericLiteral {
                    return false;
                }
                let text = parent.get_source_text();
                if !matches!(text.first(), Some(b'-' | b'+')) || matches!(text.get(1), Some(b'-' | b'+')) {
                    return false;
                }
                current = parent;
            }
            SyntaxKind::PropertyAssignment => {
                if parent.initializer() != Some(current) {
                    return false;
                }
                match parent.parent() {
                    Some(literal) => current = literal,
                    None => return false,
                }
            }
            SyntaxKind::ShorthandPropertyAssignment => match parent.parent() {
                Some(literal) => current = literal,
                None => return false,
            },
            _ => return false,
        }
    }
    false
}

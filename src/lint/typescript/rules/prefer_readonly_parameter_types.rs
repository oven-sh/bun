use bun_lint::prelude::*;
use bun_lint::types::tsutils::{is_intersection_type, is_object_type, is_union_type};
use bun_lint::types::utils::{self, ReadonlynessOptions, is_type_readonly, type_matches_some_specifier};
use bun_lint::types::{
    CheckFlags, IdMap, IdSet, ModifierFlags, NodeFlags, SymbolFlags, SyntaxKind, TsNode, TsSymbol, Type, TypeFlags,
};

/// Require function parameters to be typed as `readonly` to prevent accidental mutation of inputs.
pub struct PreferReadonlyParameterTypes {
    readonlyness: ReadonlynessOptions,
    check_parameter_properties: bool,
    ignore_inferred_types: bool,
}

const SHOULD_BE_READONLY: Message = Message::new("shouldBeReadonly", "Parameter should be a read only type.");

/// `actualParam.typeAnnotation`. An `AssignmentPattern` has none: the annotation is part of its `left`.
/// tsgolint's `parameter.Type()` is the annotation of a parameter with a default too.
fn type_annotation(param: Param<'_>, is_oxlint: bool) -> Option<TypeNode<'_>> {
    param.ty().filter(|_| is_oxlint || param.default().is_none())
}

fn get_parameter_type(param: Param<'_>, is_oxlint: bool) -> Type<'_> {
    if let Some(annotation) = type_annotation(param, is_oxlint) {
        // From the annotation, which preserves the `aliasSymbol`.
        return annotation.ts_node().get_type_from_type_node();
    }
    match param.default().is_some() || param.is_rest() {
        true => param.type_at_location(),
        false => param.pat().ty(),
    }
}

/// tsgolint's `propertyHasPrivateIdentifierName`
fn property_has_private_identifier_name(property: TsSymbol<'_>) -> bool {
    let is_private_identifier =
        |declaration: TsNode<'_>| declaration.name().is_some_and(|name| name.kind() == SyntaxKind::PrivateIdentifier);
    match property.value_declaration() {
        Some(declaration) => is_private_identifier(declaration),
        None => property.declarations().any(is_private_identifier),
    }
}

/// tsgolint's `propertyIsReadonly`, with `checker.isReadonlySymbol`: by the symbol, where typescript-eslint asks every
/// declaration.
fn property_is_readonly(property: TsSymbol<'_>) -> bool {
    let check_flags = property.check_flags();
    if check_flags.intersects(CheckFlags::READONLY | CheckFlags::SYNTHETIC_METHOD)
        || property.has_flags(SymbolFlags::ENUM_MEMBER)
        || property.flags() & SymbolFlags::ACCESSOR == SymbolFlags::GET_ACCESSOR
    {
        return true;
    }
    let Some(declaration) = property.value_declaration() else {
        return check_flags.contains(CheckFlags::MAPPED);
    };
    declaration.has_modifier(ModifierFlags::READONLY)
        || property.has_flags(SymbolFlags::METHOD) && check_flags.contains(CheckFlags::MAPPED)
        || property.has_flags(SymbolFlags::VARIABLE) && declaration.flags().intersects(NodeFlags::CONST | NodeFlags::USING)
}

/// tsgolint's `isTypeReadonlyRecurser` and what it calls, which are part of its rule.
struct Recurser<'o, 'a> {
    options: &'o ReadonlynessOptions,
    seen_types: IdSet<Type<'a>>,
}

impl<'a> Recurser<'_, 'a> {
    fn is_seen_or_readonly(&mut self, ty: Type<'a>) -> bool {
        self.seen_types.contains(ty) || self.is_type_readonly_recurser(ty)
    }

    /// `None`: neither an array nor a tuple.
    fn is_type_readonly_array_or_tuple(&mut self, ty: Type<'a>) -> Option<bool> {
        if ty.is_array_type() {
            if ty.get_symbol().is_some_and(|symbol| symbol.escaped_name() == b"Array") {
                return Some(false);
            }
        } else if !ty.tuple_target()?.readonly() {
            return Some(false);
        }
        // tsgolint looks into a type argument that it has seen, and does not end for `type A = readonly A[]`.
        Some(ty.get_type_arguments().iter().all(|type_arg| self.is_seen_or_readonly(type_arg)))
    }

    fn is_type_readonly_object(&mut self, ty: Type<'a>) -> bool {
        let properties = ty.get_properties();
        for property in properties {
            let is_skipped = self.options.treat_methods_as_readonly && property.has_flags(SymbolFlags::METHOD);
            if !is_skipped && !property_is_readonly(property) && !property_has_private_identifier_name(property) {
                return false;
            }
        }
        for property in properties {
            if property.has_flags(SymbolFlags::METHOD) || property_has_private_identifier_name(property) {
                continue;
            }
            let property_type = ty.get_type_of_property(property.name()).unwrap_or_else(|| property.get_type());
            if !self.is_seen_or_readonly(property_type) {
                return false;
            }
        }
        for info in ty.get_index_infos() {
            if !info.is_readonly() || info.ty() != ty && !self.is_seen_or_readonly(info.ty()) {
                return false;
            }
        }
        true
    }

    fn is_type_readonly_recurser(&mut self, ty: Type<'a>) -> bool {
        if !bun_core::StackCheck::init().is_safe_to_recurse() {
            return true;
        }
        self.seen_types.insert(ty);
        if type_matches_some_specifier(ty, &self.options.allow) {
            return true;
        }
        if is_union_type(ty) {
            return ty.types().iter().all(|t| self.is_seen_or_readonly(t));
        }
        if is_intersection_type(ty) {
            // Readonly arrays and tuples have methods, which look mutable.
            return match ty.types().iter().any(|t| t.is_array_type() || t.is_tuple_type()) {
                true => ty.types().iter().all(|t| self.is_seen_or_readonly(t)),
                false => self.is_type_readonly_object(ty),
            };
        }
        if !is_object_type(ty) {
            return true;
        }
        // A type that is only a function.
        if !ty.get_call_signatures().is_empty() && ty.get_properties().is_empty() {
            return true;
        }
        match self.is_type_readonly_array_or_tuple(ty) {
            Some(is_readonly) => is_readonly,
            None => self.is_type_readonly_object(ty),
        }
    }
}

/// tsgolint's `isLiteralOrTaggablePrimitiveLike`. Its `TypeFlagsLiteral` has `true` and `false`; `type.isLiteral()` has not.
fn is_literal_or_taggable_primitive_like(ty: Type<'_>) -> bool {
    ty.has_flags(TypeFlags::LITERAL)
        || ty.has_flags(TypeFlags::BIG_INT | TypeFlags::NUMBER | TypeFlags::STRING | TypeFlags::TEMPLATE_LITERAL)
}

/// tsgolint's `isTypeBrandedLiteral`
fn is_type_branded_literal(ty: Type<'_>) -> bool {
    if !is_intersection_type(ty) {
        return false;
    }
    let (mut had_object_like, mut had_primitive_like) = (false, false);
    for constituent in ty.types() {
        if is_object_type(constituent)
            && constituent.get_call_signatures().is_empty()
            && constituent.get_construct_signatures().is_empty()
        {
            had_object_like = true;
        } else if is_literal_or_taggable_primitive_like(constituent) {
            had_primitive_like = true;
        } else {
            return false;
        }
    }
    had_object_like && had_primitive_like
}

/// tsgolint's `isTypeBrandedLiteralLike`
fn is_type_branded_literal_like(ty: Type<'_>) -> bool {
    match is_union_type(ty) {
        true => ty.types().iter().all(is_type_branded_literal),
        false => is_type_branded_literal(ty),
    }
}

impl Rule for PreferReadonlyParameterTypes {
    const META: Meta = Meta::typescript("prefer-readonly-parameter-types", Kind::Suggestion).requires_types();
    const ON: On = On::new().funcs();
    /// Whether a type is to be reported. All that can be reached from it is looked at, and parameters share types.
    type State<'a> = IdMap<Type<'a>, bool>;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        PreferReadonlyParameterTypes {
            readonlyness: ReadonlynessOptions::parse(options),
            check_parameter_properties: options.bool_or("checkParameterProperties", true),
            ignore_inferred_types: options.bool_or("ignoreInferredTypes", false),
        }
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<IdMap<Type<'a>, bool>> {
        Some(IdMap::new())
    }

    fn func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        if matches!(func.kind(), FnKind::ConstructorType | FnKind::IndexSignature | FnKind::StaticBlock) {
            return;
        }
        let is_oxlint = cx.language().is_oxlint;
        // tsgolint does not look at accessors.
        if is_oxlint && matches!(func.kind(), FnKind::Getter | FnKind::Setter) {
            return;
        }
        // tsgolint's `isParameterProperty`: only a parameter of a constructor is one.
        let has_parameter_properties = !is_oxlint || func.kind() == FnKind::Constructor;
        for param in func.params_with_this() {
            let is_parameter_property = has_parameter_properties && param.is_parameter_property();
            if !self.check_parameter_properties && is_parameter_property {
                continue;
            }
            if self.ignore_inferred_types && type_annotation(param, is_oxlint).is_none() {
                continue;
            }
            let ty = get_parameter_type(param, is_oxlint);
            let is_mutable = *cx.state.get_or_insert_with(ty, || {
                let is_readonly = match is_oxlint {
                    true => Recurser { options: &self.readonlyness, seen_types: IdSet::new() }
                        .is_type_readonly_recurser(ty),
                    false => is_type_readonly(ty, &self.readonlyness),
                };
                !is_readonly
                    && !match is_oxlint {
                        true => is_type_branded_literal_like(ty),
                        false => utils::is_type_branded_literal_like(ty),
                    }
            });
            if is_mutable {
                // oxlint points at the decorators of what is no parameter property.
                let place = match is_oxlint && !is_parameter_property {
                    true => param.span(),
                    false => param.span_without_modifiers(),
                };
                cx.report(place, SHOULD_BE_READONLY);
            }
        }
    }
}

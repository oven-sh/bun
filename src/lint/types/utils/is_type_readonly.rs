//! `isTypeReadonly.ts`

use super::{
    Names, TypeOrValueSpecifier, get_type_of_property_of_type, has_room_on_the_stack,
    parse_type_or_value_specifiers, type_matches_some_specifier,
};
use crate::options::Object;
use crate::types::tsutils::{
    is_conditional_type, is_intersection_type, is_object_type, is_property_readonly_in_type,
    is_union_type,
};
use crate::types::{CheckFlags, IdSet, IndexKind, SyntaxKind, TsNode, Type, TypeStructure};

#[derive(Copy, Clone, PartialEq, Eq)]
enum Readonlyness {
    /// The type cannot be handled by the function.
    UnknownType,
    Mutable,
    Readonly,
}

/// `ReadonlynessOptions`. The default is `readonlynessOptionsDefaults`.
#[derive(Clone, PartialEq, Eq, Debug, Default)]
pub struct ReadonlynessOptions {
    /// Types that count as readonly whatever they are.
    pub allow: Vec<TypeOrValueSpecifier>,
    pub treat_methods_as_readonly: bool,
}

impl ReadonlynessOptions {
    /// From an object that has the properties of `readonlynessOptionsSchema`.
    pub fn parse(options: Object) -> ReadonlynessOptions {
        ReadonlynessOptions {
            allow: parse_type_or_value_specifiers(options.array("allow")),
            treat_methods_as_readonly: options.bool_or("treatMethodsAsReadonly", false),
        }
    }
}

struct Recurser<'o, 'a> {
    options: &'o ReadonlynessOptions,
    seen_types: IdSet<Type<'a>>,
}

/// `hasSymbol(node) && isSymbolFlagSet(node.symbol, ts.SymbolFlags.Method)`
fn declares_a_method(node: TsNode) -> bool {
    matches!(
        node.kind(),
        SyntaxKind::MethodDeclaration | SyntaxKind::MethodSignature
    )
}

/// `[type.root.node.trueType, type.root.node.falseType].map(checker.getTypeFromTypeNode)`
fn branches_of_conditional_type(ty: Type<'_>) -> Option<[Type<'_>; 2]> {
    match ty.structure() {
        TypeStructure::Conditional {
            root_true_type,
            root_false_type,
            ..
        } => Some([root_true_type, root_false_type]),
        _ => None,
    }
}

impl<'a> Recurser<'_, 'a> {
    /// `seenTypes.has(t) || isTypeReadonlyRecurser(..) === Readonlyness.Readonly`
    fn is_seen_or_readonly(&mut self, t: Type<'a>) -> bool {
        self.seen_types.contains(t) || self.is_type_readonly_recurser(t) == Readonlyness::Readonly
    }

    fn check_type_arguments(&mut self, array_type: Type<'a>) -> Readonlyness {
        // What has been looked into was not mutable, or this would not be asked. To look into it again for each path that leads
        // to it takes two to the power of the depth for a `[T, T]` of a `[U, U]` of ..
        let is_mutable = |type_arg: Type<'a>| {
            !self.seen_types.contains(type_arg)
                && self.is_type_readonly_recurser(type_arg) == Readonlyness::Mutable
        };
        match array_type.get_type_arguments().iter().any(is_mutable) {
            true => Readonlyness::Mutable,
            false => Readonlyness::Readonly,
        }
    }

    fn is_type_readonly_array_or_tuple(&mut self, ty: Type<'a>) -> Readonlyness {
        if ty.is_array_type() {
            if ty
                .get_symbol()
                .is_some_and(|symbol| symbol.escaped_name() == b"Array")
            {
                return Readonlyness::Mutable;
            }
            return self.check_type_arguments(ty);
        }
        if let Some(target) = ty.tuple_target() {
            if !target.readonly() {
                return Readonlyness::Mutable;
            }
            return self.check_type_arguments(ty);
        }
        Readonlyness::UnknownType
    }

    fn check_index_signature(&mut self, ty: Type<'a>, kind: IndexKind) -> Readonlyness {
        let Some(index_info) = ty.get_index_info(kind) else {
            return Readonlyness::UnknownType;
        };
        if !index_info.is_readonly() {
            return Readonlyness::Mutable;
        }
        if index_info.ty() == ty || self.seen_types.contains(index_info.ty()) {
            return Readonlyness::Readonly;
        }
        self.is_type_readonly_recurser(index_info.ty())
    }

    fn is_type_readonly_object(&mut self, ty: Type<'a>) -> Readonlyness {
        let properties = ty.get_properties();
        // The properties have to be marked as readonly.
        for property in properties {
            if self.options.treat_methods_as_readonly
                && (property.value_declaration().is_some_and(declares_a_method)
                    || property
                        .declarations()
                        .next_back()
                        .is_some_and(declares_a_method))
            {
                continue;
            }
            if is_property_readonly_in_type(ty, property.escaped_name()) {
                continue;
            }
            // For tsgolint 7.0 what a mapped type gives is readonly: it has no declaration of a value.
            if ty.file().language().is_oxlint && property.check_flags().contains(CheckFlags::MAPPED)
            {
                continue;
            }
            let name = property
                .value_declaration()
                .and_then(|declaration| declaration.name());
            if name.is_some_and(|name| name.kind() == SyntaxKind::PrivateIdentifier) {
                continue;
            }
            return Readonlyness::Mutable;
        }
        // Then their values have to be readonly too, which is the expensive part.
        for property in properties {
            let Some(property_type) = get_type_of_property_of_type(ty, property) else {
                continue;
            };
            // A recursive type. One that is mutable has failed above.
            if self.seen_types.contains(property_type) {
                continue;
            }
            if self.is_type_readonly_recurser(property_type) == Readonlyness::Mutable {
                return Readonlyness::Mutable;
            }
        }
        if self.check_index_signature(ty, IndexKind::String) == Readonlyness::Mutable
            || self.check_index_signature(ty, IndexKind::Number) == Readonlyness::Mutable
        {
            return Readonlyness::Mutable;
        }
        Readonlyness::Readonly
    }

    /// `Mutable` or `Readonly`.
    fn is_type_readonly_recurser(&mut self, ty: Type<'a>) -> Readonlyness {
        if !has_room_on_the_stack() {
            return Readonlyness::Readonly;
        }
        self.seen_types.insert(ty);

        let allow = &self.options.allow;
        if !allow.is_empty() {
            if let Some(alias_symbol) = ty.alias_symbol()
                && allow
                    .iter()
                    .any(|specifier| specifier.names().includes(alias_symbol.name()))
            {
                return Readonlyness::Readonly;
            }
            if type_matches_some_specifier(ty, allow) {
                return Readonlyness::Readonly;
            }
        }

        let readonly_if = |result: bool| match result {
            true => Readonlyness::Readonly,
            false => Readonlyness::Mutable,
        };

        if is_union_type(ty) {
            return readonly_if(ty.types().iter().all(|t| self.is_seen_or_readonly(t)));
        }

        if is_intersection_type(ty) {
            // Readonly arrays and tuples have methods, which look mutable.
            if ty
                .types()
                .iter()
                .any(|t| t.is_array_type() || t.is_tuple_type())
            {
                return readonly_if(ty.types().iter().all(|t| self.is_seen_or_readonly(t)));
            }
            return self.is_type_readonly_object(ty);
        }

        // tsgolint 7.0 does not look into one: it is no object, so it is readonly.
        if is_conditional_type(ty)
            && !ty.file().language().is_oxlint
            && let Some(branches) = branches_of_conditional_type(ty)
        {
            return readonly_if(branches.into_iter().all(|t| self.is_seen_or_readonly(t)));
        }

        // What is neither an object nor an intersection is a primitive.
        if !is_object_type(ty) {
            return Readonlyness::Readonly;
        }

        // A type that is only a function.
        if !ty.get_call_signatures().is_empty() && ty.get_properties().is_empty() {
            return Readonlyness::Readonly;
        }

        match self.is_type_readonly_array_or_tuple(ty) {
            Readonlyness::UnknownType => self.is_type_readonly_object(ty),
            is_readonly_array => is_readonly_array,
        }
    }
}

/// `isTypeReadonly(program, type, options)`: nothing that can be reached through a value of the
/// type can be assigned to.
pub fn is_type_readonly(ty: Type, options: &ReadonlynessOptions) -> bool {
    let mut recurser = Recurser {
        options,
        seen_types: IdSet::new(),
    };
    recurser.is_type_readonly_recurser(ty) == Readonlyness::Readonly
}

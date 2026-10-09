use bun_lint::prelude::*;

/// Disallow the `any` type.
pub struct NoExplicitAny {
    fixes_to_unknown: bool,
    ignores_rest_args: bool,
}

const SUGGEST_NEVER: Message = Message::new(
    "suggestNever",
    "Use `never` instead, this is useful when instantiating generic type parameters that you don't need to know the type of.",
);
const SUGGEST_PROPERTY_KEY: Message = Message::new(
    "suggestPropertyKey",
    "Use `PropertyKey` instead, this is more explicit than `keyof any`.",
);
const SUGGEST_UNKNOWN: Message = Message::new(
    "suggestUnknown",
    "Use `unknown` instead, this will force you to explicitly, and safely assert the type is correct.",
);
const UNEXPECTED_ANY: Message =
    Message::new("unexpectedAny", "Unexpected any. Specify a different type.");

/// typescript-eslint's `isNodeRestElementInFunction`, of what has the type annotation.
fn is_rest_element_in_function(node: Node) -> bool {
    matches!(node, Node::Param(param) if param.is_rest() && !param.is_parameter_property())
}

/// The parent of `ty` in ESTree, if that is a type: not a `TSTypeParameterInstantiation`, a
/// `TSTypeAnnotation`, a `TSNamedTupleMember`, a `TSOptionalType` or a `TSRestType`.
fn parent_type(ty: TypeNode<'_>) -> Option<TypeNode<'_>> {
    match ty.parent() {
        Node::Type(parent) => match parent.tag() {
            TypeTag::Ref | TypeTag::Heritage | TypeTag::Typeof | TypeTag::Import | TypeTag::Predicate => None,
            _ => Some(parent),
        },
        Node::TupleElem(element)
            if element.name().is_none() && !element.is_optional() && !element.is_rest() =>
        {
            element.parent().as_type()
        }
        // ESTree has the constraint of `K in C` as a child of the `TSMappedType`.
        Node::TypeParam(param) => param.parent().as_type().filter(|it| it.tag() == TypeTag::Mapped),
        _ => None,
    }
}

/// typescript-eslint's `isNodeDescendantOfRestElementInFunction`. For oxlint it can be anywhere in the type of a rest
/// parameter.
fn is_descendant_of_rest_element_in_function(any: TypeNode) -> bool {
    if any.file().language().is_oxlint {
        return Node::Type(any).ancestors().any(|it| matches!(it, Node::Param(param) if param.is_rest()));
    }
    if let Node::Type(reference) = any.parent()
        && let TypeKind::Ref { name, .. } = reference.kind()
    {
        return (name.is("Array") || name.is("ReadonlyArray"))
            && is_rest_element_in_function(reference.parent());
    }
    let Some(parent) = parent_type(any) else {
        return false;
    };
    match parent.parent() {
        Node::Type(operator) if operator.tag() == TypeTag::Readonly => {
            is_rest_element_in_function(operator.parent())
        }
        owner => is_rest_element_in_function(owner),
    }
}

impl NoExplicitAny {
    fn check<'a>(&self, ty: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        if !ty.is_keyword(Keyword::Any)
            || (self.ignores_rest_args && is_descendant_of_rest_element_in_function(ty))
        {
            return;
        }
        let parent = ty.parent();
        let report = cx.report(ty, UNEXPECTED_ANY);
        // oxlint suggests nothing, and knows no `PropertyKey`.
        if cx.language().is_oxlint {
            if self.fixes_to_unknown {
                let unknown = if is_rest_element_in_function(parent) { "unknown[]" } else { "unknown" };
                report.fix(|fixer| fixer.replace(ty, unknown));
            }
            return;
        }
        if let Node::Type(keyof) = parent
            && keyof.tag() == TypeTag::Keyof
        {
            let report = report.suggest(SUGGEST_PROPERTY_KEY, |fixer| fixer.replace(keyof, "PropertyKey"));
            if self.fixes_to_unknown {
                report.fix(|fixer| fixer.replace(keyof, "PropertyKey"));
            }
            return;
        }
        let unknown = if is_rest_element_in_function(parent) { "unknown[]" } else { "unknown" };
        let report = report
            .suggest(SUGGEST_UNKNOWN, |fixer| fixer.replace(ty, unknown))
            .suggest(SUGGEST_NEVER, |fixer| fixer.replace(ty, "never"));
        if self.fixes_to_unknown {
            report.fix(|fixer| fixer.replace(ty, unknown));
        }
    }
}

impl Rule for NoExplicitAny {
    const META: Meta = Meta::typescript("no-explicit-any", Kind::Suggestion)
        .fixable(Fixable::Code)
        .has_suggestions()
        .recommended();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        NoExplicitAny {
            fixes_to_unknown: options.bool_or("fixToUnknown", false),
            ignores_rest_args: options.bool_or("ignoreRestArgs", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.types([TypeTag::Keyword], Self::check);
    }
}

use bun_lint::prelude::*;
use bun_lint::types::Type;
use bun_lint::types::utils::{ReadonlynessOptions, is_type_branded_literal_like, is_type_readonly};
use rustc_hash::FxHashMap;

/// Require function parameters to be typed as `readonly` to prevent accidental mutation of inputs.
pub struct PreferReadonlyParameterTypes {
    readonlyness: ReadonlynessOptions,
    check_parameter_properties: bool,
    ignore_inferred_types: bool,
}

const SHOULD_BE_READONLY: Message = Message::new("shouldBeReadonly", "Parameter should be a read only type.");

/// `actualParam.typeAnnotation`. An `AssignmentPattern` has none: the annotation is part of its `left`.
fn type_annotation(param: Param<'_>) -> Option<TypeNode<'_>> {
    param.ty().filter(|_| param.default().is_none())
}

fn get_parameter_type(param: Param<'_>) -> Type<'_> {
    if let Some(annotation) = type_annotation(param) {
        // From the annotation, which preserves the `aliasSymbol`.
        return annotation.ts_node().get_type_from_type_node();
    }
    match param.default().is_some() || param.is_rest() {
        true => param.type_at_location(),
        false => param.pat().ty(),
    }
}

impl PreferReadonlyParameterTypes {
    fn check<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        if matches!(func.kind(), FnKind::ConstructorType | FnKind::IndexSignature | FnKind::StaticBlock) {
            return;
        }
        // tsgolint does not look at setters.
        if func.kind() == FnKind::Setter && cx.language().is_oxlint {
            return;
        }
        for param in func.params_with_this() {
            if !self.check_parameter_properties && param.is_parameter_property() {
                continue;
            }
            if self.ignore_inferred_types && type_annotation(param).is_none() {
                continue;
            }
            let ty = get_parameter_type(param);
            let is_mutable = || !is_type_readonly(ty, &self.readonlyness) && !is_type_branded_literal_like(ty);
            if *cx.state.entry(ty).or_insert_with(is_mutable) {
                // oxlint points at the decorators of what is no parameter property.
                let place = match cx.language().is_oxlint && !param.is_parameter_property() {
                    true => param.span(),
                    false => param.span_without_modifiers(),
                };
                cx.report(place, SHOULD_BE_READONLY);
            }
        }
    }
}

impl Rule for PreferReadonlyParameterTypes {
    const META: Meta = Meta::typescript("prefer-readonly-parameter-types", Kind::Suggestion).requires_types();
    /// Whether a type is to be reported. All that can be reached from it is looked at, and parameters share types.
    type State<'a> = FxHashMap<Type<'a>, bool>;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        PreferReadonlyParameterTypes {
            readonlyness: ReadonlynessOptions::parse(options),
            check_parameter_properties: options.bool_or("checkParameterProperties", true),
            ignore_inferred_types: options.bool_or("ignoreInferredTypes", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> FxHashMap<Type<'a>, bool> {
        on.funcs(Self::check);
        FxHashMap::default()
    }
}

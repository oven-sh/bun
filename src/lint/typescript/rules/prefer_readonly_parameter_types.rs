use bun_lint::prelude::*;
use bun_lint::types::utils::{ReadonlynessOptions, is_type_branded_literal_like, is_type_readonly};
use bun_lint::types::{IdMap, Type};

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
            let is_mutable = match cx.state.get(ty).copied() {
                Some(is_mutable) => is_mutable,
                None => {
                    let is_mutable = !is_type_readonly(ty, &self.readonlyness) && !is_type_branded_literal_like(ty);
                    cx.state.insert(ty, is_mutable);
                    is_mutable
                }
            };
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

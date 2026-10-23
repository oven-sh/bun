use bun_sema::atom::{Atom, known};
use bun_sema::bind::{Binding, Decl};
use bun_sema::check::aot::ClassRef;
use bun_sema::hir::{ClassId, ExprId};

use super::members::{self, ClassHead};
use super::{
    ClassEvaluation, ClassPlan, ClassTransform, class_plan, constructor, fields, has_decorators,
    has_instance_brand, set_class_slot,
};
use crate::ir::generated::MethodKind;
use crate::ir::{ClassSlot, StringId, ValueId};
use crate::lower::decorators::{self, StandardDecorationResult};
use crate::lower::function::{self, EntryArguments};
use crate::lower::member::{self, PropertyName};
use crate::lower::{FileLowering, FunctionLowering, expression, layouts, scope};

#[derive(Copy, Clone)]
struct Heritage {
    value: ValueId,
    prototype_parent: ValueId,
}

pub(super) fn lower_class_expression(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    class: ClassId,
    name: Option<PropertyName>,
) -> ValueId {
    evaluate_class(lowering, class, name, None)
}

pub(super) fn lower_class_declaration(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    class: ClassId,
) {
    let binding = Binding::Symbol(lowering.file.bound.declared_symbol(Decl::Class(class)));
    let name = lowering.file.hir[class].name;
    if name.is_some() {
        evaluate_class(lowering, class, None, Some((binding, name)));
        return;
    }
    let default_key = member::name_key(lowering.file, known::default);
    let default_name = PropertyName::Constant(default_key);
    evaluate_class(
        lowering,
        class,
        Some(default_name),
        Some((binding, known::default)),
    );
}

fn evaluate_class(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    class: ClassId,
    name: Option<PropertyName>,
    outer: Option<(Binding, Atom)>,
) -> ValueId {
    let (hir, bound) = (lowering.file.hir, lowering.file.bound);
    let node = hir[class];
    let plan = class_plan(lowering.file, class);
    let has_class_decorators =
        plan.transform == ClassTransform::Standard && has_decorators(hir, node.modifiers);
    let class_decorators =
        has_class_decorators.then(|| members::emit_decorator_array(lowering, node.modifiers));

    let inner = bound.inner_class_symbol(class).some();
    let class_scope = bound.class_scope[class.idx()];
    let name_scope = inner.map(|inner| bound.symbol_scope(inner));
    let name_scope = name_scope.filter(|&scope| scope != class_scope);
    if let Some(scope) = name_scope {
        scope::enter_scope(lowering, scope);
    }
    scope::enter_scope(lowering, class_scope);

    let extends = node.extends.some();
    let heritage = extends.map(|extends| lower_heritage(lowering, class, extends));
    if has_instance_brand(hir, bound, class) {
        let reference = ClassRef {
            file: lowering.file.file,
            class,
        };
        let layout = layouts::class_layout(lowering.file, reference);
        lowering.set_position(node.start);
        let token = lowering.builder.new_class_token(layout);
        set_class_slot(lowering, class, ClassSlot::ClassToken, token);
    }

    let has_own_name = node.name.is_some();
    let own_key = has_own_name.then(|| member::name_key(lowering.file, node.name));
    let name = own_key.map(PropertyName::Constant).or(name);
    let head = emit_class_head(lowering, class, &plan, name, heritage);
    let values = members::define_members(lowering, head, &plan);
    lowering.set_position(node.start);
    let class_object = lowering.builder.finish_class(head.value, head.layout);
    if let Some(inner) = inner {
        scope::initialize_binding(lowering, Binding::Symbol(inner), node.name, class_object);
    }

    let static_name = find_static_name(lowering.file, name);
    let evaluation = ClassEvaluation {
        class,
        layout: head.layout,
        class_object,
        heritage: heritage.map(|heritage| heritage.value),
        name: static_name.unwrap_or_else(|| lowering.file.intern_bytes(b"")),
        class_decorators,
        member_decorators: values.decorators,
        member_names: values.names,
    };
    let decoration = match plan.transform {
        ClassTransform::Standard => {
            decorators::emit_standard_decorations(lowering, &plan, &evaluation)
        }
        ClassTransform::None | ClassTransform::Legacy => StandardDecorationResult::default(),
    };
    lowering.set_position(node.start);
    if !plan.static_elements.is_empty() {
        let initializer = fields::declare_static_initializer(lowering.file, class);
        let arguments = EntryArguments {
            this: Some(class_object),
            ..EntryArguments::default()
        };
        function::emit_direct_call(lowering, initializer, arguments);
    }
    let value = emit_class_result(lowering, &plan, &evaluation, decoration, outer);

    scope::leave_scope(lowering, class_scope);
    if let Some(scope) = name_scope {
        scope::leave_scope(lowering, scope);
    }
    value
}

fn lower_heritage(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    class: ClassId,
    extends: ExprId,
) -> Heritage {
    let value = expression::lower_expression(lowering, extends);
    lowering.set_position(lowering.file.hir[class].start);
    let prototype_parent = lowering.builder.resolve_heritage(value);
    Heritage {
        value,
        prototype_parent,
    }
}

fn emit_class_head(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    class: ClassId,
    plan: &ClassPlan,
    name: Option<PropertyName>,
    heritage: Option<Heritage>,
) -> ClassHead {
    let static_name = find_static_name(lowering.file, name);
    let constructor = constructor::declare_constructor(lowering.file, class, plan, static_name);
    let layout = layouts::define_class_layout(lowering.file, class, constructor);

    lowering.set_position(lowering.file.hir[class].start);
    let closure = function::emit_closure(lowering, constructor, None);
    if let (Some(name), None) = (name, static_name) {
        let key = member::emit_name_value(lowering, name);
        lowering
            .builder
            .set_function_name(closure, key, MethodKind::Method);
    }
    let value = lowering.builder.new_class(
        layout,
        closure,
        heritage.map(|heritage| heritage.value),
        heritage.map(|heritage| heritage.prototype_parent),
    );
    set_class_slot(lowering, class, ClassSlot::ClassObject, value);
    ClassHead {
        class,
        layout,
        value,
    }
}

fn emit_class_result(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    plan: &ClassPlan,
    evaluation: &ClassEvaluation,
    decoration: StandardDecorationResult,
    outer: Option<(Binding, Atom)>,
) -> ValueId {
    let value = decoration
        .decorated_class
        .unwrap_or(evaluation.class_object);
    if let Some((binding, name)) = outer {
        scope::initialize_binding(lowering, binding, name, value);
    }
    match plan.transform {
        ClassTransform::None => value,
        ClassTransform::Standard => {
            if let Some(initializers) = decoration.class_initializers {
                decorators::emit_initializer_run(lowering, initializers, value);
            }
            value
        }
        ClassTransform::Legacy => {
            let decorated = decorators::apply_legacy_decorators(lowering, plan, evaluation);
            if let (Some(decorated), Some((binding, name))) = (decorated, outer) {
                scope::set_binding(lowering, binding, name, decorated);
            }
            decorated.unwrap_or(value)
        }
    }
}

fn find_static_name(
    file: &FileLowering<'_, '_, '_, '_>,
    name: Option<PropertyName>,
) -> Option<StringId> {
    match name {
        Some(PropertyName::Constant(key)) => member::find_key_text(file, key),
        Some(PropertyName::Computed(_)) | None => None,
    }
}

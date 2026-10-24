use bun_sema::atom::{Atom, known};
use bun_sema::bind::{Binding, Decl};
use bun_sema::hir::ClassId;

use super::members::ClassHead;
use super::{
    ClassEvaluation, ClassPlan, ClassTransform, constructor, fields, has_decorators,
    has_instance_brand,
};
use crate::ir::generated::MethodKind;
use crate::ir::{ClassSlot, StringId, ValueId};
use crate::lower::decorators::StandardDecorationResult;
use crate::lower::member::PropertyName;
use crate::lower::{FileLowering, FunctionLowering, layouts, scope};

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(crate) fn lower_class_expression(
        &mut self,
        class: ClassId,
        name: Option<PropertyName>,
    ) -> ValueId {
        self.evaluate_class(class, name, None)
    }

    pub(crate) fn lower_class_declaration(&mut self, class: ClassId) {
        let binding = Binding::Symbol(self.file.bound.declared_symbol(Decl::Class(class)));
        let name = self.file.hir[class].name;
        if name.is_some() {
            self.evaluate_class(class, None, Some((binding, name)));
            return;
        }
        let default_key = self.file.name_key(known::default);
        let default_name = PropertyName::Constant(default_key);
        self.evaluate_class(class, Some(default_name), Some((binding, known::default)));
    }

    fn evaluate_class(
        &mut self,
        class: ClassId,
        name: Option<PropertyName>,
        outer: Option<(Binding, Atom)>,
    ) -> ValueId {
        let (hir, bound) = (self.file.hir, self.file.bound);
        let node = hir[class];
        let plan = self.file.class_plan(class);
        let has_class_decorators =
            plan.transform == ClassTransform::Standard && has_decorators(hir, node.modifiers);
        let class_decorators =
            has_class_decorators.then(|| self.emit_decorator_array(node.modifiers));

        let inner = bound.inner_class_symbol(class).some();
        let class_scope = bound.class_scope[class.idx()];
        let name_scope = inner.map(|inner| bound.symbol_scope(inner));
        let name_scope = name_scope.filter(|&scope| scope != class_scope);
        if let Some(scope) = name_scope {
            self.enter_scope(scope);
        }
        self.enter_scope(class_scope);

        let heritage = node.extends.some().map(|extends| {
            let value = self.lower_expression(extends);
            self.set_position(node.start);
            (value, self.builder.resolve_heritage(value))
        });
        if has_instance_brand(hir, bound, class) {
            let layout = self.file.own_class_layout(class);
            self.set_position(node.start);
            let token = self.builder.new_class_token(layout);
            self.set_class_slot(class, ClassSlot::ClassToken, token);
        }

        let has_own_name = node.name.is_some();
        let binding = self.file.class_binding(class);
        let own_key = has_own_name.then(|| self.file.function_name_key(binding, node.name));
        let name = own_key.map(PropertyName::Constant).or(name);
        let head = self.emit_class_head(class, &plan, name, heritage);
        let values = self.define_members(head, &plan);
        self.set_position(node.start);
        let class_object = self.builder.finish_class(head.value, head.layout);
        let inner = inner.map(Binding::Symbol);
        if let (Some(inner), false) = (inner, has_class_decorators) {
            scope::initialize_binding(self, inner, node.name, class_object);
        }

        let static_name = self.file.find_static_name(name);
        let evaluation = ClassEvaluation {
            class,
            layout: head.layout,
            class_object,
            heritage: heritage.map(|(value, _)| value),
            name: static_name.unwrap_or_else(|| self.file.intern_bytes(b"")),
            class_decorators,
            member_decorators: values.decorators,
            member_names: values.names,
        };
        let decoration = match plan.transform {
            ClassTransform::Standard => self.emit_standard_decorations(&plan, &evaluation),
            ClassTransform::None | ClassTransform::Legacy => StandardDecorationResult::default(),
        };
        self.set_position(node.start);
        if let (Some(inner), true) = (inner, has_class_decorators) {
            let decorated = decoration.decorated_class.unwrap_or(class_object);
            scope::initialize_binding(self, inner, node.name, decorated);
        }
        if !plan.static_elements.is_empty() {
            let initializer = fields::declare_initializer(self.file, class, true);
            self.emit_call_on(initializer, class_object);
        }
        let value = self.emit_class_result(&plan, &evaluation, decoration, outer);

        self.leave_scope(class_scope);
        if let Some(scope) = name_scope {
            self.leave_scope(scope);
        }
        value
    }

    fn emit_class_head(
        &mut self,
        class: ClassId,
        plan: &ClassPlan,
        name: Option<PropertyName>,
        heritage: Option<(ValueId, ValueId)>,
    ) -> ClassHead {
        let static_name = self.file.find_static_name(name);
        let constructor = constructor::declare_constructor(self.file, class, plan, static_name);
        let layout = layouts::define_class_layout(self.file, class, Some(constructor));

        self.set_position(self.file.hir[class].start);
        let closure = self.emit_closure(constructor, None);
        if let (Some(name), None) = (name, static_name) {
            let key = self.emit_name_value(name);
            self.builder
                .set_function_name(closure, key, MethodKind::Method);
        }
        let (parent, prototype_parent) = heritage.unzip();
        let value = self
            .builder
            .new_class(layout, closure, parent, prototype_parent);
        self.set_class_slot(class, ClassSlot::ClassObject, value);
        ClassHead {
            class,
            layout,
            value,
        }
    }

    fn emit_class_result(
        &mut self,
        plan: &ClassPlan,
        evaluation: &ClassEvaluation,
        decoration: StandardDecorationResult,
        outer: Option<(Binding, Atom)>,
    ) -> ValueId {
        let value = decoration
            .decorated_class
            .unwrap_or(evaluation.class_object);
        if let Some((binding, name)) = outer {
            scope::initialize_binding(self, binding, name, value);
        }
        match plan.transform {
            ClassTransform::None => value,
            ClassTransform::Standard => {
                if let Some(initializers) = decoration.class_initializers {
                    self.emit_initializer_run(initializers, value);
                }
                value
            }
            ClassTransform::Legacy => {
                let decorated = self.apply_legacy_decorators(plan, evaluation);
                if let (Some(decorated), Some((binding, name))) = (decorated, outer) {
                    scope::set_binding(self, binding, name, decorated);
                }
                decorated.unwrap_or(value)
            }
        }
    }
}

impl FileLowering<'_, '_, '_, '_> {
    fn find_static_name(&self, name: Option<PropertyName>) -> Option<StringId> {
        match name {
            Some(PropertyName::Constant(key)) => self.find_key_text(key),
            Some(PropertyName::Computed(_)) | None => None,
        }
    }
}

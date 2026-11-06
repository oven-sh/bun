use bun_sema::atom::{Atom, known};
use bun_sema::bind::{Binding, Decl, ScopeId};
use bun_sema::hir::{ClassId, ExprKind, Flags, MemberId, start_of};
use smallvec::SmallVec;

use super::members::ClassHead;
use super::{
    ClassEvaluation, ClassPlan, ClassTransform, constructor, fields, has_decorators,
    has_instance_brand,
};
use crate::ir::generated::MethodKind;
use crate::ir::{ClassSlot, StringId, ValueId};
use crate::lower::decorators::StandardDecorationResult;
use crate::lower::member::{GivenName, PropertyName};
use crate::lower::{FileLowering, FunctionLowering, layouts, scope};

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(crate) fn lower_class_expression(
        &mut self,
        class: ClassId,
        name: Option<GivenName>,
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
        let start = self.file.hir[class].start;
        let default_name = self.file.default_export_name(start).map(|name| {
            let key = self.file.text_key(name);
            PropertyName::Constant(key).into()
        });
        self.evaluate_class(class, default_name, Some((binding, known::default)));
    }

    fn enter_class_scopes(&mut self, class: ClassId) -> (Option<ScopeId>, ScopeId) {
        let bound = self.file.bound;
        let class_scope = bound.class_scope[class.idx()];
        let inner = bound.inner_class_symbol(class).some();
        let name_scope = inner.map(|inner| bound.symbol_scope(inner));
        let name_scope = name_scope.filter(|&scope| scope != class_scope);
        if let Some(scope) = name_scope {
            self.enter_scope(scope);
        }
        self.enter_scope(class_scope);
        (name_scope, class_scope)
    }

    fn leave_class_scopes(&mut self, (name_scope, class_scope): (Option<ScopeId>, ScopeId)) {
        self.leave_scope(class_scope);
        if let Some(scope) = name_scope {
            self.leave_scope(scope);
        }
    }

    fn resolve_heritage(&mut self, class: ClassId) -> Option<(ValueId, ValueId)> {
        let extends = self.file.hir[class].extends.some()?;
        let value = self.lower_expression(extends);
        self.set_position(self.file.heritage_position(class));
        Some((value, self.builder.resolve_heritage(value)))
    }

    pub(crate) fn lower_checks_of_left_out_class(&mut self, class: ClassId) {
        let (hir, file) = (self.file.hir, self.file.file);
        let left_out = self.file.inputs.library_functions.left_out_declarations();
        let checks_heritage = left_out.is_heritage_check_kept(file, class);
        let members = hir[class].members.iter();
        let converted: SmallVec<[MemberId; 2]> = members
            .filter(|&member| left_out.is_key_conversion_kept(file, member))
            .collect();
        if !checks_heritage && converted.is_empty() {
            return;
        }
        let scopes = self.enter_class_scopes(class);
        if checks_heritage {
            self.resolve_heritage(class);
        }
        for member in converted {
            self.lower_property_name(hir.runtime_member_key(member));
        }
        self.leave_class_scopes(scopes);
    }

    fn evaluate_class(
        &mut self,
        class: ClassId,
        name: Option<GivenName>,
        outer: Option<(Binding, Atom)>,
    ) -> ValueId {
        let (hir, bound) = (self.file.hir, self.file.bound);
        let node = hir[class];
        let plan = self.file.class_plan(class);
        let has_class_decorators =
            plan.transform == ClassTransform::Standard && has_decorators(hir, node.modifiers);
        let class_decorators =
            has_class_decorators.then(|| self.emit_decorator_array(node.modifiers));
        if let Some((binding, _)) = outer {
            self.record_store_ahead_of_value(binding, self.file.class_store_position(class));
        }

        let inner = bound.inner_class_symbol(class).some();
        let scopes = self.enter_class_scopes(class);
        let heritage = self.resolve_heritage(class);
        if has_instance_brand(hir, bound, class) {
            let layout = self.file.own_class_layout(class);
            self.set_position(node.start);
            let token = self.builder.new_class_token(layout);
            self.set_class_slot(class, ClassSlot::ClassToken, token);
        }

        let has_own_name = node.name.is_some();
        let binding = self.file.class_binding(class);
        let own_key = has_own_name.then(|| {
            self.file
                .function_name_key(binding, node.name, node.name_pos)
        });
        let own_name = own_key.map(|key| GivenName::from(PropertyName::Constant(key)));
        let name = own_name.or(name);
        let head = self.emit_class_head(class, &plan, name, heritage);
        // JSC records the definition of `prototype` where the class starts.
        self.builder.record_position(node.text_start);
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
            // JSC reports the static members where the class starts, behind an `export`.
            self.set_position(node.text_start);
            self.emit_call_on(initializer, class_object);
            self.set_position(node.start);
        }
        let value = self.emit_class_result(&plan, &evaluation, decoration, outer);

        self.leave_class_scopes(scopes);
        value
    }

    fn emit_class_head(
        &mut self,
        class: ClassId,
        plan: &ClassPlan,
        name: Option<GivenName>,
        heritage: Option<(ValueId, ValueId)>,
    ) -> ClassHead {
        let static_name = self.file.find_static_name(name);
        let is_under_computed_key = name.is_some_and(|given| given.is_under_computed_key);
        let constructor = constructor::declare_constructor(
            self.file,
            class,
            plan,
            static_name,
            is_under_computed_key,
        );
        let layout = layouts::define_class_layout(self.file, class, Some(constructor));

        self.set_position(self.file.hir[class].start);
        let closure = self.emit_closure(constructor, None);
        if let (Some(given), None) = (name, static_name) {
            let key = self.emit_name_value(given.name);
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
            let position = self.file.class_store_position(evaluation.class);
            self.record_store_behind_value(binding, position);
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
    // JSC reports what it asks of a superclass where the expression starts. In front of a parenthesis, the last token the source map knows is the name of the class.
    fn heritage_position(&self, class: ClassId) -> u32 {
        let hir = self.hir;
        let node = hir[class];
        if self.runs_as_written() {
            return start_of(hir, node.extends);
        }
        let printed = self.skip_unprinted_syntax(node.extends);
        let is_printed_in_parentheses = !self.is_literal_operand(printed)
            && matches!(
                hir[printed].kind,
                ExprKind::Binary { .. }
                    | ExprKind::Cond { .. }
                    | ExprKind::Assign { .. }
                    | ExprKind::Unary { .. }
                    | ExprKind::Await(_)
                    | ExprKind::Yield { .. }
                    | ExprKind::Fn(_)
            );
        match is_printed_in_parentheses {
            true if node.name.is_some() => node.name_pos,
            true => node.text_start,
            false => self.first_position(node.extends),
        }
    }

    // JSC records the store of a class declaration as many columns behind `class` as the name is long. The source map takes that back to `class`, or to the name,
    // which it does not know in a default export.
    fn class_store_position(&self, class: ClassId) -> u32 {
        let node = self.hir[class];
        if self.runs_as_written() {
            return match node.name.is_some() {
                true => node.text_start + self.queries.atom_bytes(node.name).len() as u32,
                false => node.text_start,
            };
        }
        let has_mapped_name = node.name.is_some() && !node.flags.contains(Flags::DEFAULT);
        let name_length =
            || bun_core::strings::utf8_lossy_len_utf16(self.queries.atom_bytes(node.name));
        match has_mapped_name && name_length() as usize >= "class ".len() {
            true => node.name_pos,
            false => node.text_start,
        }
    }

    fn find_static_name(&self, name: Option<GivenName>) -> Option<StringId> {
        match name.map(|given| given.name) {
            Some(PropertyName::Constant(key)) => self.find_key_text(key),
            Some(PropertyName::Computed(_)) | None => None,
        }
    }
}

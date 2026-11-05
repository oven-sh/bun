use bun_sema::hir::PropKey;
use smallvec::SmallVec;

use super::{DefaultHolder, PatternNode};
use crate::ir::generated::RuntimeErrorKind;
use crate::ir::{LayoutId, ValueId};
use crate::lower::FunctionLowering;
use crate::lower::member::PropertyName;
use crate::modules::ModuleRef;

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(super) fn destructure_object(&mut self, node: PatternNode, value: ValueId) {
        let properties = self.file.pattern_properties(node);
        let error_name = self.file.nullish_error_name(&properties);
        let error_name = error_name.map(|name| self.file.intern_atom(name));
        let nullish = self.create_block();
        let object = self.branch_if_nullish(value, nullish);
        let resume = self.builder.current_block();
        self.continue_in(nullish);
        self.emit_throw_runtime_error(RuntimeErrorKind::NotDestructurable, error_name);
        self.builder.switch_to(resume);
        let has_rest = properties.iter().any(|property| property.is_rest);
        let mut read_names: SmallVec<[PropertyName; 8]> = SmallVec::new();
        for property in &properties {
            self.set_position(property.position);
            if property.is_rest {
                let prepared = self.prepare_target(property.target);
                let position = self.file.node_position(node);
                self.set_position(position);
                let layout = self.find_rest_layout(property.target);
                let copy = self.emit_object_rest(object, &read_names, layout);
                self.finish_target(property.target, prepared, copy);
                continue;
            }
            let name = match property.key {
                PropKey::Computed(_) => self.lower_property_name(property.key),
                PropKey::None | PropKey::Name(_) | PropKey::Private(_) => {
                    let Some(name) = self.file.property_name(property) else {
                        continue;
                    };
                    PropertyName::Constant(self.file.name_key(name))
                }
            };
            let prepared = self.prepare_target(property.target);
            self.set_position(property.position);
            let read = self.emit_get(object, name);
            let holder = DefaultHolder::ObjectPattern;
            let read = super::apply_default(self, read, property.default, property.target, holder);
            self.finish_target(property.target, prepared, read);
            if has_rest {
                read_names.push(name);
            }
        }
    }

    pub(super) fn destructure_exports(&mut self, node: PatternNode, module: ModuleRef) {
        for property in &self.file.pattern_properties(node) {
            debug_assert!(!property.is_rest, "a rest element looks at the object");
            self.set_position(property.position);
            let Some(name) = self.file.property_name(property) else {
                debug_assert!(false, "a computed key looks at the object");
                continue;
            };
            let prepared = self.prepare_target(property.target);
            self.set_position(property.position);
            let read = match self.read_named_export(module, name) {
                Some(read) => read,
                None => self.builder.undefined(),
            };
            let holder = DefaultHolder::ObjectPattern;
            let read = super::apply_default(self, read, property.default, property.target, holder);
            self.finish_target(property.target, prepared, read);
        }
    }

    fn find_rest_layout(&mut self, target: PatternNode) -> Option<LayoutId> {
        let queries = &mut *self.file.queries;
        let ty = match target {
            PatternNode::Binding(pattern) => queries.binding_type(pattern).ok()?,
            PatternNode::Assignment(target) => {
                let assigned = queries.expression_type(target).ok()?;
                queries.without_nullish(assigned).ok()?
            }
        };
        self.file.object_type_layout(ty)
    }
}

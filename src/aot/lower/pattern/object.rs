use bun_sema::hir::PropKey;
use smallvec::SmallVec;

use super::PatternNode;
use crate::ir::generated::RuntimeErrorKind;
use crate::ir::{LayoutId, ValueId};
use crate::lower::FunctionLowering;
use crate::lower::member::PropertyName;
use crate::modules::ModuleRef;

impl FunctionLowering<'_, '_, '_, '_, '_> {
    // JSC records no position for what an object pattern tests and reads.
    pub(super) fn destructure_object(&mut self, node: PatternNode, value: ValueId, mapped: u32) {
        let properties = self.file.pattern_properties(node);
        self.set_position_to_last_recorded();
        let error_name = self.file.nullish_error_name(&properties);
        let error_name = error_name.map(|name| self.file.intern_atom(name));
        let nullish = self.create_unlikely_block();
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
                // JSC records the copy at the pattern and nothing for the store. The `{` of an assignment is the start of an expression, which the source map knows.
                let recorded = match node {
                    PatternNode::Binding(_) if !self.file.runs_as_written() => mapped,
                    PatternNode::Binding(_) | PatternNode::Assignment(_) => {
                        self.file.node_position(node)
                    }
                };
                self.set_position(recorded);
                let layout = self.find_rest_layout(property.target);
                let copy = self.emit_object_rest(object, &read_names, layout);
                self.builder.record_position(recorded);
                self.finish_target(property.target, prepared, copy, property.position, recorded);
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
            self.set_position_to_last_recorded();
            self.builder.set_written_position(property.position);
            let read = self.emit_get(object, name);
            self.set_position(property.position);
            let read = super::apply_default(self, read, property.default, property.target);
            let mapped = self.file.last_mapped_key_position(property);
            let member_store = self.file.last_mapped_target_position(property.target);
            self.finish_target(property.target, prepared, read, mapped, member_store);
            if has_rest {
                read_names.push(name);
            }
        }
    }

    // `const { a, b: c = d } = require(K)`, where nobody looks at what the call yields: each name is read once, here, from where the module keeps it.
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
            let read = super::apply_default(self, read, property.default, property.target);
            let mapped = self.file.last_mapped_key_position(property);
            let member_store = self.file.last_mapped_target_position(property.target);
            self.finish_target(property.target, prepared, read, mapped, member_store);
        }
    }

    // The copy is converted to the type of the binding, which only an object with the layout of that type passes.
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

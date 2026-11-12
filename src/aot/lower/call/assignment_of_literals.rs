use bun_sema::atom::known;
use bun_sema::hir::{Call, ExprId, ExprKind, PropKey, PropKind};
use smallvec::SmallVec;

use crate::builtins::id::BuiltinId;
use crate::ir::generated::ECMAMode;
use crate::ir::{TypeTable, ValueId};
use crate::lower::FunctionLowering;
use crate::lower::member::PropertyName;
use crate::lower::object::finish_object;

type Properties = Vec<(PropertyName, ValueId, ExprId)>;

enum Source {
    Literal(ExprId, Properties),
    Value(ValueId),
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(in crate::lower) fn lower_assignment_of_literals(
        &mut self,
        call: ExprId,
        site: Call,
    ) -> Option<ValueId> {
        let hir = self.file.hir;
        let arguments: SmallVec<[ExprId; 4]> = hir.ids(site.args).collect();
        let (&target, sources) = arguments.split_first()?;
        let is_spread = |&argument: &ExprId| matches!(hir[argument].kind, ExprKind::Spread(_));
        let target_is_literal = matches!(
            hir[hir.skip_type_assertions(target)].kind,
            ExprKind::Object(_)
        );
        if target_is_literal
            || arguments.iter().any(is_spread)
            || !sources
                .iter()
                .any(|&source| self.is_literal_of_plain_names(source))
        {
            return None;
        }

        self.emit_locked_builtin(BuiltinId::ObjectAssign);
        let target = self.lower_expression(target);
        let sources: SmallVec<[Source; 2]> = (sources.iter())
            .map(|&source| match self.is_literal_of_plain_names(source) {
                true => Source::Literal(source, self.lower_values_of_literal(source)),
                false => Source::Value(self.lower_expression(source)),
            })
            .collect();
        let outer = self.builder.set_tail_position(false);
        self.set_position(self.file.call_position(site));
        let result = self.builder.create_variable(None);
        let done = self.create_block();
        let split = self.split_on_type(target, TypeTable::OBJECT);
        self.builder.switch_to(split.taken);
        let object = split.taken_value;
        for source in &sources {
            match source {
                Source::Literal(_, properties) => {
                    for &(name, value, _) in properties {
                        self.emit_set_in_mode(object, name, value, ECMAMode::Strict);
                    }
                }
                &Source::Value(value) => {
                    self.emit_builtin_call(BuiltinId::ObjectAssign, &[object, value]);
                }
            }
        }
        self.builder.write_variable(result, object);
        self.jump(done);

        self.builder.switch_to(split.not_taken);
        let mut written: SmallVec<[ValueId; 4]> = SmallVec::new();
        written.push(split.not_taken_value);
        for source in &sources {
            written.push(match source {
                Source::Literal(literal, properties) => {
                    let layout = self.file.literal_layout(hir.skip_type_assertions(*literal));
                    let mut made = self.begin_object(layout);
                    for &(name, value, source) in properties {
                        self.add_property(&mut made, name, value, Some(source));
                    }
                    finish_object(self, made)
                }
                &Source::Value(value) => value,
            });
        }
        let made = self.emit_builtin_call(BuiltinId::ObjectAssign, &written);
        self.builder.write_variable(result, made);
        self.jump(done);

        self.continue_in(done);
        let result = self.builder.read_variable(result);
        self.builder.set_tail_position(outer);
        self.set_position(hir[call].pos);
        Some(self.claim_call_result(call, result))
    }

    fn is_literal_of_plain_names(&mut self, source: ExprId) -> bool {
        let hir = self.file.hir;
        let ExprKind::Object(properties) = hir[hir.skip_type_assertions(source)].kind else {
            return false;
        };
        let mut names: SmallVec<[_; 8]> = SmallVec::new();
        properties.iter().all(|id| {
            let property = hir[id];
            let PropKey::Name(name) = hir.runtime_property_key(id) else {
                return false;
            };
            let key = self.file.name_key(name);
            let is_plain = matches!(property.kind, PropKind::Init | PropKind::Shorthand)
                && name != known::__proto__
                && self.file.find_element_index(key).is_none()
                && !names.contains(&name);
            names.push(name);
            is_plain
        })
    }

    fn lower_values_of_literal(&mut self, literal: ExprId) -> Properties {
        let hir = self.file.hir;
        let ExprKind::Object(properties) = hir[hir.skip_type_assertions(literal)].kind else {
            unreachable!("is_literal_of_plain_names has looked");
        };
        let mut values = Properties::new();
        for id in properties.iter() {
            let property = hir[id];
            let key = hir.runtime_property_key(id);
            self.set_position(property.pos);
            let name = self.lower_property_name(key);
            let given = self.name_under_property(&property, key, name);
            let value = self.lower_named_evaluation(property.value, given);
            values.push((name, value, property.value));
        }
        values
    }
}

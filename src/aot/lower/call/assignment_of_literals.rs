use bun_sema::atom::known;
use bun_sema::bind::{BindingInitializer, BindingKind, Parent};
use bun_sema::hir::{Call, Chain, ExprId, ExprKind, PatKind, PropKey, PropKind};
use smallvec::SmallVec;

use super::written_operands::find_locked_builtin;
use crate::builtins::id::BuiltinId;
use crate::ir::generated::ECMAMode;
use crate::ir::{TypeTable, ValueId};
use crate::lower::FunctionLowering;
use crate::lower::expression::Tail;
use crate::lower::member::PropertyName;
use crate::lower::object::{MOST_VALUES_THAT_WAIT_IN_REGISTERS, ObjectBuilder, finish_object};
use crate::lower::scope;

type Properties = Vec<(PropertyName, ValueId, ExprId)>;

enum Source {
    Literal(ExprId, Properties),
    MadeLiteral(ValueId, SmallVec<[PropertyName; 16]>),
    Value(ValueId),
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(in crate::lower) fn lower_assignment_of_literals(
        &mut self,
        call: ExprId,
        site: Call,
        tail: Tail<'_>,
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
        let is_object = self.makes_object(target) || self.is_variable_of_literal(target);
        let target = self.lower_expression(target);
        let sources: SmallVec<[Source; 2]> = (sources.iter())
            .map(|&source| match self.is_literal_of_plain_names(source) {
                true => self.lower_source_literal(source),
                false => Source::Value(self.lower_expression(source)),
            })
            .collect();
        let outer = self.builder.set_tail_position(false);
        let is_tail = matches!(tail, Tail::Yes { .. });
        self.set_position(self.file.call_position(site));
        let result = match is_object {
            true => {
                self.store_sources(target, &sources, is_tail);
                target
            }
            false => self.store_sources_into_object(target, &sources, is_tail),
        };
        self.builder.set_tail_position(outer);
        self.set_position(hir[call].pos);
        Some(self.claim_call_result(call, result))
    }

    fn makes_object(&self, expression: ExprId) -> bool {
        match self.file.hir[self.file.skip_type_syntax(expression)].kind {
            ExprKind::Object(_) | ExprKind::New(_) => true,
            ExprKind::Call(number) => {
                let site = self.file.hir[number];
                matches!(site.chain, Chain::No)
                    && find_locked_builtin(self.file, site.callee) == Some(BuiltinId::ObjectCreate)
            }
            _ => false,
        }
    }

    fn is_variable_of_literal(&self, target: ExprId) -> bool {
        let (hir, bound) = (self.file.hir, self.file.bound);
        let Some(symbol) = scope::find_tested_local(self, target) else {
            return false;
        };
        let is_lexical = matches!(
            bound.binding_kind(symbol),
            BindingKind::Const | BindingKind::Let
        );
        if !is_lexical || !bound.is_stable_binding(symbol) || bound.is_visible_to_eval(symbol) {
            return false;
        }
        let BindingInitializer::Expression(value) = bound.binding_initializer(hir, symbol) else {
            return false;
        };
        let Parent::VarInit(declaration) = bound.parent_of_expr(value) else {
            return false;
        };
        let is_plain_name = matches!(hir[hir[declaration].pat].kind, PatKind::Ident(_));
        is_plain_name && self.makes_object(value)
    }

    fn store_sources(&mut self, object: ValueId, sources: &[Source], is_tail: bool) {
        let outer = self.builder.set_tail_position(is_tail);
        let function = Some(BuiltinId::ObjectAssign);
        for source in sources {
            match source {
                Source::Literal(_, properties) => {
                    for &(name, value, _) in properties {
                        self.emit_set_inside(object, name, value, ECMAMode::Strict, function);
                    }
                }
                Source::MadeLiteral(literal, names) => {
                    for &name in names {
                        let value = self.emit_get(*literal, name);
                        self.emit_set_inside(object, name, value, ECMAMode::Strict, function);
                    }
                }
                &Source::Value(value) => {
                    self.emit_builtin_call(BuiltinId::ObjectAssign, &[object, value]);
                }
            }
        }
        self.builder.set_tail_position(outer);
    }

    fn store_sources_into_object(
        &mut self,
        target: ValueId,
        sources: &[Source],
        is_tail: bool,
    ) -> ValueId {
        let result = self.builder.create_variable(None);
        let done = self.create_block();
        let split = self.split_on_type(target, TypeTable::OBJECT);
        self.builder.switch_to(split.taken);
        self.store_sources(split.taken_value, sources, is_tail);
        self.builder.write_variable(result, split.taken_value);
        self.jump(done);

        self.builder.switch_to(split.not_taken);
        let mut written: SmallVec<[ValueId; 4]> = SmallVec::new();
        written.push(split.not_taken_value);
        for source in sources {
            written.push(match source {
                Source::Literal(literal, properties) => {
                    let made = self.begin_literal_of(*literal, properties);
                    finish_object(self, made)
                }
                &Source::MadeLiteral(value, _) | &Source::Value(value) => value,
            });
        }
        let outer = self.builder.set_tail_position(is_tail);
        let made = self.emit_builtin_call(BuiltinId::ObjectAssign, &written);
        self.builder.set_tail_position(outer);
        self.builder.write_variable(result, made);
        self.jump(done);

        self.continue_in(done);
        self.builder.read_variable(result)
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

    fn begin_literal_of(
        &mut self,
        literal: ExprId,
        properties: &[(PropertyName, ValueId, ExprId)],
    ) -> ObjectBuilder {
        let literal = self.file.hir.skip_type_assertions(literal);
        let layout = self.file.literal_layout(literal);
        let mut made = self.begin_object(layout);
        for &(name, value, source) in properties {
            self.add_property(&mut made, name, value, Some(source));
        }
        made
    }

    fn lower_source_literal(&mut self, literal: ExprId) -> Source {
        let hir = self.file.hir;
        let ExprKind::Object(properties) = hir[hir.skip_type_assertions(literal)].kind else {
            unreachable!("is_literal_of_plain_names has looked");
        };
        let mut values = Properties::new();
        let mut waiting = 0;
        let mut made = None;
        for id in properties.iter() {
            let property = hir[id];
            let key = hir.runtime_property_key(id);
            self.set_position(property.pos);
            let name = self.lower_property_name(key);
            let given = self.name_under_property(&property, key, name);
            let value = self.lower_named_evaluation(property.value, given);
            values.push((name, value, property.value));
            if let Some(made) = &mut made {
                self.add_property(made, name, value, Some(property.value));
                continue;
            }
            waiting += usize::from(!self.costs_no_word_while_it_waits(value));
            if waiting > MOST_VALUES_THAT_WAIT_IN_REGISTERS {
                made = Some(self.begin_literal_of(literal, &values));
            }
        }
        match made {
            Some(made) => {
                let names = values.iter().map(|&(name, ..)| name).collect();
                Source::MadeLiteral(finish_object(self, made), names)
            }
            None => Source::Literal(literal, values),
        }
    }
}

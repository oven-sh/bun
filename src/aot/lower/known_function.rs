use bun_sema::bind::{Binding, FnOwner, Parent};
use bun_sema::hir::{FnId, PropKey};

use super::FunctionLowering;
use super::member::PropertyName;
use crate::known_helpers::Shape;
use crate::statistics::StatisticId;

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(in crate::lower) fn emit_fast_path(&mut self, source: FnId) {
        let helpers = self.file.inputs.known_helpers;
        let Some(known) = helpers.function(self.file.file, source) else {
            return;
        };
        self.file.count(StatisticId::KnownHelperFunctions, 1);
        match known.shape {
            Shape::CreateBindingReusesDescriptor => {
                if let [_, getter] = known.functions[..] {
                    self.emit_live_binding(source, getter);
                }
            }
            Shape::ExportStarBindsNamesTheTargetLacks => {
                self.emit_export_star_fast_path(source);
            }
            _ => {}
        }
    }

    fn emit_live_binding(&mut self, source: FnId, getter: FnId) {
        let shape = Shape::CreateBindingReusesDescriptor;
        let Some((builtins, definition)) = self.file.find_create_binding_builtins(source, shape)
        else {
            return;
        };
        let FnOwner::Expr(expression) = self.file.bound.fns[getter.idx()].owner else {
            return;
        };
        let Parent::Prop(property) = self.file.bound.parent_of_expr(expression) else {
            return;
        };
        let PropKey::Name(name) = self.file.hir.runtime_property_key(property) else {
            return;
        };
        let name = PropertyName::Constant(self.file.name_key(name));
        let parameter = |index| self.file.find_parameter(source, index);
        let (Some(target), Some(module)) = (parameter(0), parameter(1)) else {
            return;
        };
        let (Some(source_key), Some(target_key)) = (parameter(2), parameter(3)) else {
            return;
        };
        if self.file.hir[source].params.len() != 4 {
            return;
        }

        let written_body = self.create_unlikely_block();
        for &named in &builtins {
            self.guard_builtin_path(named, written_body);
        }
        self.set_position(self.file.hir[definition].pos);
        let [target, module, source_key, target_key] = [target, module, source_key, target_key]
            .map(|(symbol, name)| self.get_binding(Binding::Symbol(symbol), name));
        let getter = self.lower_function_expression(getter, Some(name));
        let is_defined = self
            .builder
            .try_define_live_binding(target, module, source_key, target_key, getter);
        self.emit_guard(is_defined, written_body);
        self.emit_empty_return();
        self.continue_in(written_body);
    }
}

use bun_sema::bind::{Binding, CodeUnit, Decl, has_simple_parameter_list};
use bun_sema::hir::{FnId, ParamId, PatKind};
use smallvec::SmallVec;

use crate::ir::{DeclaredType, ValueId};
use crate::lower::member::PropertyName;
use crate::lower::scope::{BindingForm, BindingRef, ScopeSlot};
use crate::lower::{FunctionLowering, convert, scope};

type InitialBindings = SmallVec<[(BindingRef, ValueId); 4]>;

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(crate) fn lower_parameters(&mut self, source: FnId) {
        let hir = self.file.hir;
        let top = self.file.bound.fns[source.idx()].scope;
        let positions = self.file.function_positions(source);
        let parameters = hir[source].params;
        let count = self.builder.function().parameters.len() as u32;
        let get_parameter = |index| self.builder.parameter(index);
        let values: SmallVec<[ValueId; 4]> = (0..count).map(get_parameter).collect();
        let mut initial = InitialBindings::new();
        let unit = CodeUnit::Function(source);
        if let Some(object) = self.create_arguments_object(unit, &values) {
            initial.push((BindingRef::Slot(top, ScopeSlot::Arguments), object));
        }
        if has_simple_parameter_list(hir, source) {
            self.collect_simple_parameters(source, &values, &mut initial);
            self.allocate_scope(top, &initial);
        } else {
            self.allocate_scope(top, &initial);
            for (index, parameter) in parameters.iter().enumerate() {
                self.bind_parameter(parameter, values[index], positions.parameters[index]);
            }
        }
        self.emit_parameter_var_copies(source);
        self.instantiate_functions(top);
    }

    fn collect_simple_parameters(
        &mut self,
        source: FnId,
        values: &[ValueId],
        initial: &mut InitialBindings,
    ) {
        let hir = self.file.hir;
        let bound = self.file.bound;
        for (index, parameter) in hir[source].params.iter().enumerate() {
            let node = hir[parameter];
            self.set_position(node.pos);
            let symbol = bound.declared_symbol(Decl::Param(node.pat));
            match self.file.scopes.form(symbol) {
                BindingForm::Stored => initial.push((BindingRef::Symbol(symbol), values[index])),
                BindingForm::NotAValue
                | BindingForm::Import
                | BindingForm::Callee { .. }
                | BindingForm::MappedArgument { .. }
                | BindingForm::ContainerMember { .. } => {}
            }
        }
        initial.reverse();
        initial.sort_by_key(|entry| entry.0);
        initial.dedup_by_key(|entry| entry.0);
    }

    fn bind_parameter(&mut self, parameter: ParamId, mut value: ValueId, position: DeclaredType) {
        let hir = self.file.hir;
        let node = hir[parameter];
        self.set_position(node.pos);
        if node.default.is_some() {
            value = apply_default(self, parameter, value, position);
        }
        match hir[node.pat].kind {
            PatKind::Ident(name) => {
                let symbol = self.file.bound.declared_symbol(Decl::Param(node.pat));
                self.initialize_converted_symbol(symbol, name, value);
            }
            PatKind::Object(_) | PatKind::Array(_) => {
                self.bind_pattern(node.pat, value, None);
            }
            PatKind::Missing => {}
        }
    }

    fn emit_parameter_var_copies(&mut self, source: FnId) {
        let bound = self.file.bound;
        let copies = bound.runtime.parameter_var_copies();
        let start = copies.partition_point(|copy| copy.function < source);
        let end = copies.partition_point(|copy| copy.function <= source);
        for copy in &copies[start..end] {
            let name = bound.symbol(copy.variable).name;
            let value = self.get_binding(Binding::Symbol(copy.parameter), name);
            scope::initialize_binding(self, Binding::Symbol(copy.variable), name, value);
        }
    }
}

fn apply_default(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    parameter: ParamId,
    value: ValueId,
    position: DeclaredType,
) -> ValueId {
    let hir = lowering.file.hir;
    let node = hir[parameter];
    let result = lowering.builder.create_variable(None);
    let use_default = lowering.create_block();
    let join = lowering.create_block();
    let present = lowering.branch_if_undefined(value, use_default);
    lowering.builder.write_variable(result, present);
    lowering.jump(join);
    lowering.continue_in(use_default);
    let default = match hir[node.pat].kind {
        PatKind::Ident(name) => {
            let binding = lowering.file.bound.initialized_binding(node.pat);
            let key = lowering.file.function_name_key(binding, name);
            lowering.lower_named_evaluation(node.default, PropertyName::Constant(key))
        }
        PatKind::Object(_) | PatKind::Array(_) | PatKind::Missing => {
            lowering.lower_expression(node.default)
        }
    };
    let subject = convert::Int32Subject::Parameter(parameter);
    lowering.describe_int32_flow(position, subject, Some(node.default));
    // The parameter takes `undefined` for an argument that is left out. The binding behind the default does not.
    let initialized = match hir[node.pat].kind {
        PatKind::Ident(_) => {
            let symbol = lowering.file.bound.declared_symbol(Decl::Param(node.pat));
            lowering.file.binding_position(symbol)
        }
        PatKind::Object(_) | PatKind::Array(_) | PatKind::Missing => position,
    };
    let default = lowering.convert_initializer(default, initialized, Some(node.default));
    lowering.builder.write_variable(result, default);
    lowering.jump(join);
    lowering.continue_in(join);
    lowering.builder.read_variable(result)
}

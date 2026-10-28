use bun_sema::bind::{Binding, Bound, CodeUnit, Decl, SymbolId, has_simple_parameter_list};
use bun_sema::hir::{self, FnId, FnKind, ParamId, PatId, PatKind};
use smallvec::SmallVec;

use crate::ir::generated::FunctionFlags;
use crate::ir::{DeclaredType, ValueId};
use crate::lower::pattern::{PatternNode, apply_default_with};
use crate::lower::scope::{BindingForm, BindingRef, ScopeSlot, Storage};
use crate::lower::{FileLowering, FunctionLowering, convert, scope};

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(crate) fn lower_parameters(&mut self, source: FnId) {
        let hir = self.file.hir;
        let top = self.file.bound.fns[source.idx()].scope;
        let positions = self.file.function_positions(source);
        let parameters = hir[source].params;
        let count = self.builder.function().parameters.len() as u32;
        let get_parameter = |index| self.builder.parameter(index);
        let values: SmallVec<[ValueId; 4]> = (0..count).map(get_parameter).collect();
        let mut initial: SmallVec<[(BindingRef, ValueId); 4]> = SmallVec::new();
        let unit = CodeUnit::Function(source);
        if let Some(object) = self.create_arguments_object(unit, &values) {
            initial.push((BindingRef::Slot(top, ScopeSlot::Arguments), object));
        }
        if has_simple_parameter_list(hir, source) {
            for (index, parameter) in parameters.iter().enumerate() {
                let node = hir[parameter];
                self.set_position(node.pos);
                let symbol = self.file.bound.declared_symbol(Decl::Param(node.pat));
                match self.file.scopes.form(symbol) {
                    BindingForm::Stored => {
                        initial.push((BindingRef::Symbol(symbol), values[index]));
                    }
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
            self.allocate_scope(top, &initial);
        } else {
            self.allocate_scope(top, &initial);
            let mut mapped = self.file.parameters_position(source);
            for (index, parameter) in parameters.iter().enumerate() {
                let node = hir[parameter];
                self.set_position(node.pos);
                let value =
                    apply_default(self, parameter, values[index], positions.parameters[index]);
                match hir[node.pat].kind {
                    PatKind::Ident(name) => {
                        let symbol = self.file.bound.declared_symbol(Decl::Param(node.pat));
                        if !self.is_kept_in_register(Binding::Symbol(symbol)) {
                            let recorded = self.file.recorded_binding_position(node.pat);
                            self.builder.record_position(recorded);
                        }
                        self.initialize_converted_symbol(symbol, name, value);
                    }
                    PatKind::Object(_) | PatKind::Array(_) => {
                        self.bind_pattern(node.pat, value, None, mapped);
                    }
                    PatKind::Missing => {}
                }
                mapped = match node.default.some() {
                    Some(default) => self.file.last_mapped_position(default),
                    None => {
                        let last = self.file.last_mapped_pattern_position(node.pat);
                        last.unwrap_or(mapped)
                    }
                };
            }
        }
        let bound = self.file.bound;
        let copies = bound.runtime.parameter_var_copies();
        let start = copies.partition_point(|copy| copy.function < source);
        let end = copies.partition_point(|copy| copy.function <= source);
        for copy in &copies[start..end] {
            let name = bound.symbol(copy.variable).name;
            let value = self.get_binding(Binding::Symbol(copy.parameter), name);
            scope::initialize_binding(self, Binding::Symbol(copy.variable), name, value);
        }
        let flags = self.builder.function().flags;
        if flags.contains(FunctionFlags::IS_GENERATOR) {
            self.builder.begin_code_with_records_of_its_own();
        }
        self.instantiate_functions(top);
        self.list_held_bindings(source);
    }

    fn list_held_bindings(&mut self, source: FnId) {
        let flags = self.builder.function().flags;
        if !flags.intersects(FunctionFlags::IS_ASYNC | FunctionFlags::IS_GENERATOR) {
            return;
        }
        let top = self.file.bound.fns[source.idx()].scope;
        let symbols = parameter_symbols(self.file.hir, self.file.bound, source);
        let names = symbols.into_iter().map(BindingRef::Symbol);
        let arguments = BindingRef::Slot(top, ScopeSlot::Arguments);
        self.coroutine.held = names.chain([arguments]).collect();
    }

    // What the names of the parameters hold here. A name that closures share lies in an environment.
    pub(in crate::lower) fn get_held_values(&mut self) -> SmallVec<[ValueId; 4]> {
        let mut values: SmallVec<[ValueId; 4]> = SmallVec::new();
        for index in 0..self.coroutine.held.len() {
            let binding = self.coroutine.held[index];
            let placement = self.file.scopes.placement(binding);
            let value = match (self.scopes.find_local(binding), placement) {
                (Some(local), _) => self.builder.read_variable(local.variable),
                (None, Some(placement)) => match placement.storage {
                    Storage::Field { scope, .. } => self.get_environment(scope),
                    Storage::Local | Storage::Variable(_) => continue,
                },
                (None, None) => continue,
            };
            if !values.contains(&value) {
                values.push(value);
            }
        }
        values
    }
}

pub(in crate::lower) fn parameter_symbols(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    function: FnId,
) -> SmallVec<[SymbolId; 4]> {
    let mut symbols: SmallVec<[SymbolId; 4]> = SmallVec::new();
    let parameters = hir[function].params.iter();
    let mut pending: SmallVec<[PatId; 8]> =
        parameters.map(|parameter| hir[parameter].pat).collect();
    while let Some(pattern) = pending.pop() {
        if pattern.is_none() {
            continue;
        }
        match hir[pattern].kind {
            PatKind::Ident(_) => match bound.initialized_binding(pattern) {
                Binding::Symbol(symbol) => symbols.push(symbol),
                Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => {}
            },
            PatKind::Missing => {}
            PatKind::Object(properties) => {
                pending.extend(properties.iter().map(|property| hir[property].value));
            }
            PatKind::Array(elements) => {
                pending.extend(elements.iter().map(|element| hir[element].pat));
            }
        }
    }
    symbols.sort_unstable();
    symbols
}

fn apply_default(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    parameter: ParamId,
    value: ValueId,
    position: DeclaredType,
) -> ValueId {
    let hir = lowering.file.hir;
    let node = hir[parameter];
    let target = PatternNode::Binding(node.pat);
    // The parameter takes `undefined` for an argument that is left out. The binding behind the default does not.
    apply_default_with(
        lowering,
        value,
        node.default,
        target,
        &mut |lowering, default| {
            let subject = convert::Int32Subject::Parameter(parameter);
            lowering.describe_int32_flow(position, subject, Some(node.default));
            let initialized = match hir[node.pat].kind {
                PatKind::Ident(_) => {
                    let symbol = lowering.file.bound.declared_symbol(Decl::Param(node.pat));
                    lowering.file.binding_position(symbol)
                }
                PatKind::Object(_) | PatKind::Array(_) | PatKind::Missing => position,
            };
            lowering.convert_initializer(default, initialized, Some(node.default))
        },
    )
}

impl FileLowering<'_, '_, '_, '_> {
    // The source map of Bun's transpiler knows the `(` of a function and the first token of an arrow function.
    pub(in crate::lower) fn parameters_position(&self, function: FnId) -> u32 {
        let node = self.hir[function];
        match node.kind {
            FnKind::Arrow => node.text_start,
            _ => node.anchor,
        }
    }
}

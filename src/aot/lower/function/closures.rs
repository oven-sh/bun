use bun_sema::hir::{FnId, FnKind};
use smallvec::SmallVec;

use super::EntryArguments;
use crate::ir::generated::{EntryParameter, FunctionFlags, MethodKind};
use crate::ir::{DeclaredType, FunctionId, TypeTable, ValueId};
use crate::lower::member::{self, PropertyName};
use crate::lower::{FunctionLowering, convert};

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(crate) fn lower_function_expression(
        &mut self,
        function: FnId,
        name: Option<PropertyName>,
    ) -> ValueId {
        self.create_named_closure(function, name, None)
    }

    pub(crate) fn lower_method(
        &mut self,
        function: FnId,
        name: PropertyName,
        home: ValueId,
    ) -> ValueId {
        self.create_named_closure(function, Some(name), Some(home))
    }

    pub(crate) fn emit_closure(&mut self, function: FunctionId, home: Option<ValueId>) -> ValueId {
        let key = self.file.function_key(function);
        let values = self.collect_capture_values(key, home);
        self.builder.new_closure(function, &values)
    }

    pub(crate) fn emit_direct_call(
        &mut self,
        function: FunctionId,
        arguments: EntryArguments<'_>,
    ) -> ValueId {
        let key = self.file.function_key(function);
        let header = self.file.function_header(function);
        let flags = header.flags;
        let this_type = header.this_type;
        let parameters: SmallVec<[DeclaredType; 4]> = SmallVec::from_slice(&header.parameters);
        let values = arguments.parameters;

        let has_rest_parameter = flags.contains(FunctionFlags::HAS_REST_PARAMETER);
        let mut operands: SmallVec<[ValueId; 8]> = SmallVec::new();
        for kind in EntryParameter::ALL {
            if !flags.contains(kind.present_with()) {
                continue;
            }
            match kind {
                EntryParameter::Capture => {
                    operands.extend(self.collect_capture_values(key, None));
                }
                EntryParameter::This => {
                    let this = arguments.this.unwrap_or_else(|| self.builder.undefined());
                    operands.push(convert::convert(self, this, this_type, None));
                }
                EntryParameter::Callee => operands.push(self.emit_closure(function, None)),
                EntryParameter::NewTarget => {
                    let new_target = arguments.new_target;
                    operands.push(new_target.unwrap_or_else(|| self.builder.undefined()));
                }
                EntryParameter::ArgumentCount => {
                    operands.push(self.builder.integer(values.len() as i64));
                }
                EntryParameter::Parameter => {
                    debug_assert!(
                        !has_rest_parameter || !parameters.is_empty(),
                        "a rest parameter is a declared parameter"
                    );
                    let positional = parameters
                        .len()
                        .saturating_sub(usize::from(has_rest_parameter));
                    for (index, &position) in parameters[..positional].iter().enumerate() {
                        let value = match values.get(index) {
                            Some(&value) => value,
                            None => self.builder.undefined(),
                        };
                        operands.push(convert::convert(self, value, position, None));
                    }
                    if let Some(&position) = parameters.get(positional) {
                        let rest = values.get(positional..).unwrap_or(&[]);
                        let rest = self.emit_argument_list(rest);
                        operands.push(convert::convert(self, rest, position, None));
                    }
                }
                EntryParameter::HiddenRest => {
                    let rest = values.get(parameters.len()..).unwrap_or(&[]);
                    operands.push(self.emit_argument_list(rest));
                }
            }
        }
        self.builder.call_direct(function, &operands)
    }

    pub(in crate::lower) fn create_named_closure(
        &mut self,
        function: FnId,
        name: Option<PropertyName>,
        home: Option<ValueId>,
    ) -> ValueId {
        let func = self.file.hir[function];
        let has_own_name = match func.kind {
            FnKind::Decl | FnKind::Expr => func.name.is_some(),
            _ => false,
        };
        let inferred_name = name.filter(|_| !has_own_name);
        let header_name = match inferred_name {
            Some(PropertyName::Constant(key)) => member::find_function_name(self.file, key),
            Some(PropertyName::Computed(_)) | None => None,
        };
        if let (Some(PropertyName::Constant(key)), None) = (inferred_name, header_name)
            && let Some(name) = self.file.find_name_under_symbol(key)
        {
            let id = super::declare_source_function_with(self.file, function, &mut |_, header| {
                header.name = Some(name);
                header.flags |= FunctionFlags::IS_NAMED_BY_SYMBOL;
            });
            return self.emit_closure(id, home);
        }
        let id = super::declare_source_function(self.file, function, header_name);
        let closure = self.emit_closure(id, home);
        if let (Some(name), None) = (inferred_name, header_name) {
            let key = self.emit_name_value(name);
            let kind = match func.kind {
                FnKind::Getter => MethodKind::Getter,
                FnKind::Setter => MethodKind::Setter,
                _ => MethodKind::Method,
            };
            self.builder.set_function_name(closure, key, kind);
        }
        closure
    }

    fn emit_argument_list(&mut self, values: &[ValueId]) -> ValueId {
        self.builder.new_array(TypeTable::ANYTHING, &[], values)
    }
}

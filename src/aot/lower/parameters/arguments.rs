use bun_sema::bind::CodeUnit;

use crate::ir::ValueId;
use crate::ir::generated::FunctionFlags;
use crate::lower::FunctionLowering;
use crate::lower::scope::ArgumentsObject;

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(in crate::lower) fn create_arguments_object(
        &mut self,
        unit: CodeUnit,
        parameters: &[ValueId],
    ) -> Option<ValueId> {
        let callee = match self.file.scopes.arguments_object(unit) {
            ArgumentsObject::None => return None,
            ArgumentsObject::Unmapped => None,
            ArgumentsObject::Mapped => {
                let callee = self.builder.callee();
                Some(callee.expect("a mapped arguments object names its callee"))
            }
        };
        let count = self.builder.argument_count();
        let count = count.expect("a function with an arguments object takes the count");
        let function = self.builder.function();
        let declared_count = function.parameters.len();
        let has_rest_parameter = function.flags.contains(FunctionFlags::HAS_REST_PARAMETER);
        let (positional_count, rest) = match has_rest_parameter {
            true => {
                let last = declared_count - 1;
                (last, Some(self.builder.parameter(last as u32)))
            }
            false => (declared_count, self.builder.hidden_rest()),
        };
        let rest = rest.expect("a function with an arguments object takes the rest");
        let positional = &parameters[..positional_count];
        let builder = &mut self.builder;
        Some(match callee {
            Some(callee) => builder.create_mapped_arguments(callee, count, rest, positional),
            None => builder.create_unmapped_arguments(count, rest, positional),
        })
    }
}

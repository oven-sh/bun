use bun_sema::bind::CodeUnit;

use crate::ir::ValueId;
use crate::ir::generated::FunctionFlags;
use crate::lower::FunctionLowering;
use crate::lower::scope::ArgumentsObject;

pub(super) fn create_arguments_object(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    unit: CodeUnit,
    parameters: &[ValueId],
) -> Option<ValueId> {
    let callee = match lowering.file.scopes.arguments_object(unit) {
        ArgumentsObject::None => return None,
        ArgumentsObject::Unmapped => None,
        ArgumentsObject::Mapped => {
            let callee = lowering.builder.callee();
            Some(callee.expect("a mapped arguments object names its callee"))
        }
    };
    let count = lowering.builder.argument_count();
    let count = count.expect("a function with an arguments object takes the count");
    let (positional_count, rest) = split_rest(lowering);
    let rest = rest.expect("a function with an arguments object takes the rest");
    let positional = &parameters[..positional_count];
    let builder = &mut lowering.builder;
    Some(match callee {
        Some(callee) => builder.create_mapped_arguments(callee, count, rest, positional),
        None => builder.create_unmapped_arguments(count, rest, positional),
    })
}

fn split_rest(lowering: &FunctionLowering<'_, '_, '_, '_, '_>) -> (usize, Option<ValueId>) {
    let function = lowering.builder.function();
    let declared_count = function.parameters.len();
    if !function.flags.contains(FunctionFlags::HAS_REST_PARAMETER) {
        return (declared_count, lowering.builder.hidden_rest());
    }
    let last = declared_count - 1;
    (last, Some(lowering.builder.parameter(last as u32)))
}

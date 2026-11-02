use super::{Bun__AOT__isOptionalPass, Bun__AOT__operationCount, Bun__AOT__operationName};
use crate::ir::generated::PassId;

pub fn operation_names() -> Vec<&'static [u8]> {
    let count = Bun__AOT__operationCount();
    let mut names = Vec::with_capacity(count);
    for index in 0..count {
        let name = Bun__AOT__operationName(index);
        if name.len == 0 {
            continue;
        }
        // SAFETY: a name is an `ASCIILiteral` of the engine: static storage, readable for `len` bytes, that nothing writes or frees.
        names.push(unsafe { core::slice::from_raw_parts(name.ptr, name.len) });
    }
    names
}

pub fn is_optional_pass(pass: PassId) -> bool {
    Bun__AOT__isOptionalPass(pass.to_wire())
}

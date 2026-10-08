//! `getValueOfLiteralType.ts`

use crate::types::{Literal, Type};

/// `getValueOfLiteralType(type)`: the string, the number or the bigint. `None` if
/// [`Type::is_literal`] is false. As a `BigInt`, `-0n` is `0n`.
pub fn get_value_of_literal_type(ty: Type<'_>) -> Option<Literal<'_>> {
    Some(match ty.value()? {
        Literal::BigInt { base10: b"0", .. } => Literal::BigInt {
            negative: false,
            base10: b"0",
        },
        value => value,
    })
}

// PORT NOTE: conceptually a 2-bit enum; Rust has no `u2` repr, so we use the
// smallest available (`u8`). Only 3 variants, so layout/ABI is unaffected for
// any consumer.
#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum SQLQueryResultMode {
    Objects = 0,
    Values = 1,
    Raw = 2,
}

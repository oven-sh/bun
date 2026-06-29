#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum SQLQueryResultMode {
    Objects = 0,
    Values = 1,
    Raw = 2,
}

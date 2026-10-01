// internal/ast/diagnostic.go: the arguments of a diagnostic message.

// One argument of a message, as `any` in upstream's variadic parameters.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Arg<'a> {
    Str(&'a [u8]),
    Int(i64),
    Bool(bool),
}

impl Default for Arg<'_> {
    fn default() -> Self {
        Arg::Str(b"")
    }
}

impl<'a> From<&'a [u8]> for Arg<'a> {
    fn from(value: &'a [u8]) -> Self {
        Arg::Str(value)
    }
}
impl<'a, const N: usize> From<&'a [u8; N]> for Arg<'a> {
    fn from(value: &'a [u8; N]) -> Self {
        Arg::Str(value)
    }
}
impl<'a> From<&'a str> for Arg<'a> {
    fn from(value: &'a str) -> Self {
        Arg::Str(value.as_bytes())
    }
}
impl From<i32> for Arg<'_> {
    fn from(value: i32) -> Self {
        Arg::Int(i64::from(value))
    }
}
impl From<isize> for Arg<'_> {
    fn from(value: isize) -> Self {
        Arg::Int(value as i64)
    }
}
impl From<usize> for Arg<'_> {
    fn from(value: usize) -> Self {
        Arg::Int(i64::try_from(value).unwrap_or(i64::MAX))
    }
}
impl From<bool> for Arg<'_> {
    fn from(value: bool) -> Self {
        Arg::Bool(value)
    }
}

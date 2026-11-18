/// A `UErrorCode` that is a failure.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Error(i32);

pub type Result<T> = core::result::Result<T, Error>;

impl Error {
    pub const ILLEGAL_ARGUMENT: Error = Error(1);
    pub const MISSING_RESOURCE: Error = Error(2);
    pub const MEMORY_ALLOCATION: Error = Error(7);
    pub const BUFFER_OVERFLOW: Error = Error(15);
    pub const UNSUPPORTED: Error = Error(16);
    pub const RESOURCE_TYPE_MISMATCH: Error = Error(17);
}

/// The `UErrorCode` that a call reads and writes. Below zero is a warning.
#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(transparent)]
pub(crate) struct Status(i32);

impl Status {
    /// What a call starts with.
    #[inline]
    pub(crate) fn new() -> Status {
        crate::default_locale::settle();
        Status(0)
    }

    /// For the calls that come before all others.
    pub(crate) const fn during_setup() -> Status {
        Status(0)
    }

    #[inline]
    pub(crate) fn result(self) -> Result<()> {
        if self.0 > 0 {
            Err(Error(self.0))
        } else {
            Ok(())
        }
    }
}

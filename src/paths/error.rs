/// The result does not fit a fixed-size buffer. The path is unchanged.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NameTooLong;

impl From<NameTooLong> for bun_errno::SystemErrno {
    #[inline]
    fn from(_: NameTooLong) -> Self {
        Self::ENAMETOOLONG
    }
}

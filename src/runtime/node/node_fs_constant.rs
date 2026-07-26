// File Copy Constants
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub struct Copyfile(pub i32);

impl Copyfile {
    /// Wrap a raw flags value.
    #[inline]
    pub(crate) const fn from_raw(raw: i32) -> Self {
        Self(raw)
    }

    pub(crate) const EXCLUSIVE: i32 = 1;
    pub(crate) const FORCE: i32 = 4;

    #[inline]
    pub(crate) fn is_force_clone(self) -> bool {
        (self.0 & COPYFILE_FICLONE_FORCE) != 0
    }

    #[inline]
    pub(crate) fn shouldnt_overwrite(self) -> bool {
        (self.0 & COPYFILE_EXCL) != 0
    }
}

/// Constant for fs.copyFile. Flag indicating the destination file should not be overwritten if it already exists.
pub(crate) const COPYFILE_EXCL: i32 = Copyfile::EXCLUSIVE;
///
/// Constant for fs.copyFile. Copy operation will attempt to create a copy-on-write reflink.
/// If the underlying platform does not support copy-on-write, then the operation will fail with an error.
pub(crate) const COPYFILE_FICLONE_FORCE: i32 = Copyfile::FORCE;

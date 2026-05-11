use core::num::NonZeroUsize;

/// Inert state for `bun_io::KeepAlive`.
///
/// The type crate owns only the status shape. Platform loop ref/unref effects
/// stay in `bun_io::{posix,windows}_event_loop`.
#[repr(u8)]
#[derive(Default, Copy, Clone, Debug, PartialEq, Eq)]
pub enum KeepAliveState {
    Active,
    #[default]
    Inactive,
    Done,
}

impl KeepAliveState {
    #[inline]
    pub fn is_active(self) -> bool {
        self == Self::Active
    }

    #[inline]
    pub fn is_inactive(self) -> bool {
        self == Self::Inactive
    }

    #[inline]
    pub fn is_done(self) -> bool {
        self == Self::Done
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct KeepAliveHandle(NonZeroUsize);

impl KeepAliveHandle {
    /// Build a non-null lower KeepAlive handle from a raw address value.
    ///
    /// The handle is only pointer identity at this layer. Ref/unref effects
    /// stay with `bun_io`, which owns `KeepAlive`.
    #[inline]
    pub const fn from_usize(handle: usize) -> Option<Self> {
        match NonZeroUsize::new(handle) {
            Some(handle) => Some(Self(handle)),
            None => None,
        }
    }

    #[inline]
    pub fn from_ptr<T>(ptr: *mut T) -> Option<Self> {
        Self::from_usize(ptr.cast::<()>() as usize)
    }

    #[inline]
    pub const fn get(self) -> usize {
        self.0.get()
    }

    #[inline]
    pub fn as_ptr<T>(self) -> *mut T {
        self.0.get() as *mut T
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keep_alive_state_preserves_zig_tag_shape() {
        assert_eq!(core::mem::size_of::<KeepAliveState>(), 1);
        assert!(KeepAliveState::default().is_inactive());
        assert!(KeepAliveState::Active.is_active());
        assert!(KeepAliveState::Done.is_done());
    }

    #[test]
    fn keep_alive_handle_rejects_null_and_preserves_pointer() {
        assert!(KeepAliveHandle::from_usize(0).is_none());

        let mut raw = 0u8;
        let ptr = core::ptr::from_mut(&mut raw);
        let handle = KeepAliveHandle::from_ptr(ptr).unwrap();

        assert_eq!(handle.as_ptr::<u8>(), ptr);
        assert_eq!(handle.get(), ptr.cast::<()>() as usize);
    }
}

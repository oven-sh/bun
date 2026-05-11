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
}

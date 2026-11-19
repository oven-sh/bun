use crate::coding::Read;

#[derive(Default, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ConnectionId {
    len: u8,
    /// Zeros after the first `len`.
    bytes: [u8; Self::MAX_LEN],
}

impl ConnectionId {
    /// RFC 9000 §17.2.
    pub(crate) const MAX_LEN: usize = 20;

    /// `None` if there are too many bytes.
    #[inline]
    pub fn new(from: &[u8]) -> Option<Self> {
        let mut bytes = [0; Self::MAX_LEN];
        bytes.get_mut(..from.len())?.copy_from_slice(from);
        Some(Self {
            len: from.len() as u8,
            bytes,
        })
    }

    /// Behind its length as a byte.
    #[inline]
    pub(crate) fn read(input: &mut &[u8]) -> Option<Self> {
        let len = input.u8()?;
        Self::new(input.bytes(len.into())?)
    }

    #[inline]
    pub(crate) fn write(&self, out: &mut Vec<u8>) {
        out.push(self.len);
        out.extend_from_slice(self);
    }
}

impl core::ops::Deref for ConnectionId {
    type Target = [u8];

    #[inline]
    fn deref(&self) -> &[u8] {
        self.bytes.get(..self.len.into()).unwrap_or_default()
    }
}

impl core::fmt::Debug for ConnectionId {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        self.iter().try_for_each(|byte| write!(f, "{byte:02x}"))
    }
}

/// An ID that this endpoint issued. These are random and have one length.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct LocalId(pub(crate) [u8; Self::LEN]);

impl LocalId {
    pub(crate) const LEN: usize = 8;

    #[inline]
    pub(crate) fn new(from: &[u8]) -> Option<Self> {
        from.try_into().ok().map(Self)
    }
}

impl core::hash::Hash for LocalId {
    #[inline]
    fn hash<H: core::hash::Hasher>(&self, state: &mut H) {
        state.write_u64(u64::from_ne_bytes(self.0));
    }
}

impl From<LocalId> for ConnectionId {
    fn from(id: LocalId) -> Self {
        Self::new(&id.0).unwrap_or_default()
    }
}

/// RFC 9000 §10.3.
#[derive(Clone, Copy, Eq)]
pub(crate) struct ResetToken(pub(crate) [u8; Self::LEN]);

impl ResetToken {
    pub(crate) const LEN: usize = 16;
}

impl core::fmt::Debug for ResetToken {
    fn fmt(&self, f: &mut core::fmt::Formatter) -> core::fmt::Result {
        f.write_str("ResetToken")
    }
}

impl PartialEq for ResetToken {
    /// One comparison without an early exit (RFC 9000 §10.3.1).
    fn eq(&self, other: &Self) -> bool {
        let difference = u128::from_ne_bytes(self.0) ^ u128::from_ne_bytes(other.0);
        core::hint::black_box(difference as u64 | (difference >> 64) as u64) == 0
    }
}

impl core::hash::Hash for ResetToken {
    fn hash<H: core::hash::Hasher>(&self, state: &mut H) {
        state.write(&self.0);
    }
}

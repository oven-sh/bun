/// Where a call writes. Neither kind grows.
pub enum Output<'a> {
    /// What is left of the slice.
    Slice(&'a mut [u8]),
    #[non_exhaustive]
    Append { to: &'a mut Vec<u8>, room: usize },
}

impl<'a> Output<'a> {
    /// The spare capacity of `to`, but no more than `limit` bytes of it.
    pub fn append(to: &'a mut Vec<u8>, limit: usize) -> Self {
        let room = (to.capacity() - to.len()).min(limit);
        Self::Append { to, room }
    }

    pub fn room(&self) -> usize {
        match self {
            Self::Slice(slice) => slice.len(),
            Self::Append { room, .. } => *room,
        }
    }

    /// Returns how many of `bytes` fit.
    pub(crate) fn write(&mut self, bytes: &[u8]) -> usize {
        let (fits, _) = bytes.split_at(bytes.len().min(self.room()));
        match self {
            Self::Slice(slice) => {
                let (head, tail) = core::mem::take(slice).split_at_mut(fits.len());
                head.copy_from_slice(fits);
                *slice = tail;
            }
            Self::Append { to, room } => {
                to.extend_from_slice(fits);
                *room -= fits.len();
            }
        }
        fits.len()
    }
}

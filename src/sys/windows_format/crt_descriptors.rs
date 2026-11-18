//! `lpReserved2`, which describes file descriptors to the C runtime of a child: their number, a byte of flags each, a handle each.

/// More are not handed on.
pub const MAX_COUNT: usize = 255;

pub(crate) const OPEN: u8 = 0x01;
pub(crate) const PIPE: u8 = 0x08;
pub(crate) const DEVICE: u8 = 0x40;

/// `None` is one that is closed.
pub(crate) fn encode(descriptors: &[Option<(u8, usize)>]) -> Vec<u8> {
    let mut block = Vec::with_capacity(4 + descriptors.len() * (1 + size_of::<usize>()));
    block.extend_from_slice(&(descriptors.len() as u32).to_le_bytes());
    block.extend(
        descriptors
            .iter()
            .map(|it| it.map_or(0, |(flags, _)| flags)),
    );
    for descriptor in descriptors {
        let handle = descriptor.map_or(usize::MAX, |(_, handle)| handle);
        block.extend_from_slice(&handle.to_le_bytes());
    }
    block
}

/// The flags and the handles, or none if `block` does not hold as many as it says.
fn decode(block: &[u8]) -> (&[u8], &[[u8; size_of::<usize>()]]) {
    let decoded = block.split_first_chunk().and_then(|(count, rest)| {
        let count = u32::from_le_bytes(*count) as usize;
        let (flags, handles) = rest.split_at_checked(count)?;
        Some((flags, handles.as_chunks().0.get(..count)?))
    });
    decoded.unwrap_or_default()
}

pub(crate) fn handles(block: &[u8]) -> impl Iterator<Item = usize> {
    decode(block).1.iter().copied().map(usize::from_le_bytes)
}

pub fn are_open(block: &[u8]) -> impl Iterator<Item = bool> {
    decode(block).0.iter().map(|flags| flags & OPEN != 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layout() {
        let block = encode(&[Some((OPEN | PIPE | DEVICE, 0x1234)), None]);
        assert_eq!(block[..6], [2, 0, 0, 0, 0x49, 0]);
        assert_eq!(block[6..14], [0x34, 0x12, 0, 0, 0, 0, 0, 0]);
        assert_eq!(block[14..], [0xFF; 8]);
    }

    #[test]
    fn reads_the_handles_behind_the_flags() {
        let mut block = 2u32.to_ne_bytes().to_vec();
        block.extend([9, 0]);
        block.extend(0x10usize.to_ne_bytes());
        block.extend(usize::MAX.to_ne_bytes());
        assert!(handles(&block).eq([0x10, usize::MAX]));
        assert!(are_open(&block).eq([true, false]));

        block.push(0);
        assert_eq!(handles(&block).count(), 2);
        for len in 0..block.len() - 1 {
            assert_eq!(handles(&block[..len]).count(), 0);
        }
        assert_eq!(handles(&u32::MAX.to_ne_bytes()).count(), 0);
    }
}

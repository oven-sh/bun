#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RuntimeBufferedReaderTarget {
    FilterRunHandle { index: usize },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RuntimeBufferedReaderDelivery<'a> {
    FilterRunHandleChunk {
        index: usize,
        chunk: &'a [u8],
    },
}

impl RuntimeBufferedReaderTarget {
    #[inline]
    pub const fn has_on_read_chunk(self) -> bool {
        match self {
            Self::FilterRunHandle { .. } => true,
        }
    }

    #[inline]
    pub fn on_read_chunk<'a>(self, chunk: &'a [u8]) -> RuntimeBufferedReaderDelivery<'a> {
        match self {
            Self::FilterRunHandle { index } => RuntimeBufferedReaderDelivery::FilterRunHandleChunk {
                index,
                chunk,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filter_run_reader_target_preserves_index_and_chunk() {
        let chunk = b"hello";
        let target = RuntimeBufferedReaderTarget::FilterRunHandle { index: 7 };

        assert!(target.has_on_read_chunk());
        match target.on_read_chunk(chunk) {
            RuntimeBufferedReaderDelivery::FilterRunHandleChunk { index, chunk: actual } => {
                assert_eq!(index, 7);
                assert_eq!(actual, chunk);
            }
        }
    }
}

//! How what a session keeps is laid out in a file.

#[derive(Default)]
pub(crate) struct RecordWriter(pub Vec<u8>);

impl RecordWriter {
    pub(crate) fn number(&mut self, number: f64) {
        self.0.extend_from_slice(&number.to_le_bytes());
    }

    pub(crate) fn count(&mut self, count: usize) {
        self.0.extend_from_slice(&(count as u32).to_le_bytes());
    }

    pub(crate) fn bytes(&mut self, bytes: &[u8]) {
        self.count(bytes.len());
        self.0.extend_from_slice(bytes);
    }

    pub(crate) fn optional(&mut self, bytes: Option<&[u8]>) {
        self.count(bytes.is_some().into());
        self.bytes(bytes.unwrap_or_default());
    }
}

pub(crate) struct RecordReader<'a>(pub &'a [u8]);

impl<'a> RecordReader<'a> {
    fn array<const N: usize>(&mut self) -> Option<[u8; N]> {
        let (first, rest) = self.0.split_first_chunk()?;
        self.0 = rest;
        Some(*first)
    }

    pub(crate) fn number(&mut self) -> Option<f64> {
        self.array().map(f64::from_le_bytes)
    }

    pub(crate) fn count(&mut self) -> Option<usize> {
        self.array().map(|it| u32::from_le_bytes(it) as usize)
    }

    pub(crate) fn bytes(&mut self) -> Option<&'a [u8]> {
        let length = self.count()?;
        let (bytes, rest) = self.0.split_at_checked(length)?;
        self.0 = rest;
        Some(bytes)
    }

    pub(crate) fn optional(&mut self) -> Option<Option<&'a [u8]>> {
        let (is_there, bytes) = (self.count()? == 1, self.bytes()?);
        Some(is_there.then_some(bytes))
    }

    pub(crate) fn list<T>(
        &mut self,
        mut item: impl FnMut(&mut Self) -> Option<T>,
    ) -> Option<Vec<T>> {
        (0..self.count()?).map(|_| item(self)).collect()
    }
}

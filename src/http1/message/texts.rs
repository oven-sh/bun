use core::range::Range;

use bun_core::BoundedArray;

/// How many fields are kept before they have to be taken.
const MAX_FIELDS: usize = 31;

#[derive(Default)]
pub(super) struct Texts {
    /// The URL or the status text.
    first: Range<usize>,
    names_and_values: BoundedArray<Range<usize>, { 2 * MAX_FIELDS }>,
    /// So many texts are in `saved`, in order. The others are in the current read.
    saved_count: usize,
    saved: Vec<u8>,
}

impl Texts {
    #[inline]
    pub(super) fn clear(&mut self) {
        self.clear_first();
        self.names_and_values.clear();
        if self.saved_count > 0 {
            self.saved_count = 0;
            self.saved = Vec::new();
        }
    }

    #[inline]
    pub(super) fn clear_first(&mut self) {
        self.first = Range::default();
    }

    #[inline]
    pub(super) fn clear_fields(&mut self) {
        self.names_and_values.clear();
        if self.saved_count > 1 {
            self.saved_count = 1;
            self.saved.truncate(self.first.end);
        }
    }

    #[inline]
    pub(super) fn last_is_name(&self) -> bool {
        !self.names_and_values.len().is_multiple_of(2)
    }

    /// Adds a name or a value, if there is room. There is for the value of a name.
    #[inline]
    pub(super) fn push(&mut self, text: Range<usize>) -> bool {
        self.names_and_values.push(text).is_ok()
    }

    /// Appends to the last text, which is empty or saved.
    #[inline]
    pub(super) fn extend(&mut self, input: &[u8], text: Range<usize>) {
        let is_saved = self.saved_count > self.names_and_values.len();
        let last = self.names_and_values.last_mut();
        let last = last.unwrap_or(&mut self.first);
        if is_saved {
            self.saved
                .extend_from_slice(input.get(text).unwrap_or_default());
            last.end = self.saved.len();
        } else {
            *last = text;
        }
    }

    /// Copies what is still in `input`.
    #[inline]
    pub(super) fn save(&mut self, input: &[u8]) {
        let last = self.names_and_values.last().unwrap_or(&self.first);
        let count = self.names_and_values.len() + usize::from(!last.is_empty());
        if self.saved_count < count {
            self.save_until(input, count);
        }
    }

    fn save_until(&mut self, input: &[u8], count: usize) {
        let texts = [&mut self.first].into_iter();
        let texts = texts.chain(self.names_and_values.iter_mut());
        for text in texts.take(count).skip(self.saved_count) {
            let bytes = input.get(*text).unwrap_or_default();
            text.start = self.saved.len();
            self.saved.extend_from_slice(bytes);
            text.end = self.saved.len();
        }
        self.saved_count = count;
    }

    #[inline]
    fn get<'a>(&'a self, input: &'a [u8], index: usize, text: Range<usize>) -> &'a [u8] {
        let source = match index < self.saved_count {
            true => &self.saved,
            false => input,
        };
        source.get(text).unwrap_or_default()
    }

    #[inline]
    pub(super) fn first<'a>(&'a self, input: &'a [u8]) -> &'a [u8] {
        self.get(input, 0, self.first)
    }

    #[inline]
    pub(super) fn last<'a>(&'a self, input: &'a [u8]) -> &'a [u8] {
        let last = self.names_and_values.last().unwrap_or(&self.first);
        self.get(input, self.names_and_values.len(), *last)
    }

    #[inline]
    pub(super) fn fields<'a>(
        &'a self,
        input: &'a [u8],
    ) -> impl ExactSizeIterator<Item = (&'a [u8], &'a [u8])> {
        let (fields, _) = self.names_and_values.as_chunks();
        fields.iter().enumerate().map(move |(i, &[name, value])| {
            (
                self.get(input, 2 * i + 1, name),
                self.get(input, 2 * i + 2, value),
            )
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clear_frees_the_copies() {
        let mut texts = Texts::default();
        texts.extend(b"a", (0..1).into());
        texts.save(b"a");
        assert_eq!(texts.first(b""), b"a");
        texts.clear();
        assert_eq!(texts.saved.capacity(), 0);
    }

    #[test]
    fn clear_fields_drops_their_copies() {
        let mut texts = Texts::default();
        texts.extend(b"ab", (0..1).into());
        assert!(texts.push((1..2).into()));
        texts.save(b"ab");
        texts.clear_fields();
        assert_eq!(texts.saved, b"a");
        assert_eq!(texts.first(b""), b"a");
    }
}

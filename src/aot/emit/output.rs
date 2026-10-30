use std::mem::MaybeUninit;

pub(super) struct OutputSlice<'a>(&'a mut [MaybeUninit<u8>]);

impl<'a> OutputSlice<'a> {
    pub(super) fn new(bytes: &'a mut [MaybeUninit<u8>]) -> OutputSlice<'a> {
        OutputSlice(bytes)
    }

    pub(super) fn take(&mut self, bytes: usize) -> OutputSlice<'a> {
        let (taken, rest) = std::mem::take(&mut self.0).split_at_mut(bytes);
        self.0 = rest;
        OutputSlice(taken)
    }

    pub(super) fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub(super) fn put_words(&mut self, words: &[u32]) {
        if cfg!(target_endian = "little") {
            let first_byte = words.as_ptr().cast::<u8>();
            // SAFETY: every byte of a `u32` is initialized, and a byte is aligned anywhere.
            self.put_bytes(unsafe { std::slice::from_raw_parts(first_byte, size_of_val(words)) });
        } else {
            words
                .iter()
                .for_each(|word| self.put_bytes(&word.to_le_bytes()));
        }
    }

    pub(super) fn put_bytes(&mut self, bytes: &[u8]) {
        self.take(bytes.len()).0.write_copy_of_slice(bytes);
    }

    pub(super) fn fill_with_zeros(&mut self) {
        std::mem::take(&mut self.0).fill(MaybeUninit::new(0));
    }
}

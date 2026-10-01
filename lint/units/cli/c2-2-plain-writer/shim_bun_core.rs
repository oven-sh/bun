// Stand-in for the helpers of bun_core::strings that src/lint calls, with the semantics read from src/bun_core/string/immutable.rs.
pub mod strings {
    pub fn index_of_char_usize(slice: &[u8], char: u8) -> Option<usize> {
        slice.iter().position(|&b| b == char)
    }
    pub fn last_index_of_char(slice: &[u8], char: u8) -> Option<usize> {
        slice.iter().rposition(|&b| b == char)
    }
    pub fn count_char(slice: &[u8], char: u8) -> usize {
        slice.iter().filter(|&&b| b == char).count()
    }
    fn memmem(haystack: &[u8], needle: &[u8]) -> Option<usize> {
        if needle.is_empty() {
            return Some(0);
        }
        if haystack.len() < needle.len() {
            return None;
        }
        (0..=haystack.len() - needle.len()).find(|&i| &haystack[i..i + needle.len()] == needle)
    }
    pub fn index_of(self_: &[u8], str: &[u8]) -> Option<usize> {
        if self_.is_empty() || str.is_empty() || self_.len() < str.len() {
            return None;
        }
        if str.len() == 1 {
            return index_of_char_usize(self_, str[0]);
        }
        memmem(self_, str)
    }
    pub struct SplitIterator<'a> {
        buffer: &'a [u8],
        index: Option<usize>,
        delimiter: &'a [u8],
    }
    pub fn split<'a>(self_: &'a [u8], delimiter: &'a [u8]) -> SplitIterator<'a> {
        SplitIterator { buffer: self_, index: Some(0), delimiter }
    }
    impl<'a> Iterator for SplitIterator<'a> {
        type Item = &'a [u8];
        fn next(&mut self) -> Option<&'a [u8]> {
            let start = self.index?;
            let end = if let Some(delim_start) = index_of(&self.buffer[start..], self.delimiter) {
                let del = delim_start + start;
                self.index = Some(del + self.delimiter.len());
                delim_start + start
            } else {
                self.index = None;
                self.buffer.len()
            };
            Some(&self.buffer[start..end])
        }
    }
    pub fn replace_owned(input: &[u8], needle: &[u8], replacement: &[u8]) -> Vec<u8> {
        if needle.is_empty() {
            return input.to_vec();
        }
        let mut out = Vec::new();
        let mut i = 0usize;
        while let Some(pos) = memmem(&input[i..], needle) {
            out.extend_from_slice(&input[i..i + pos]);
            out.extend_from_slice(replacement);
            i += pos + needle.len();
        }
        out.extend_from_slice(&input[i..]);
        out
    }
}

// Stand-in for bstr::BStr as the tests use it: bytes that compare and print readably.
#[derive(PartialEq, Eq)]
#[repr(transparent)]
pub struct BStr([u8]);
impl BStr {
    pub fn new<B: ?Sized + AsRef<[u8]>>(bytes: &B) -> &BStr {
        let bytes: &[u8] = bytes.as_ref();
        // SAFETY: `BStr` is a transparent wrapper of `[u8]`.
        unsafe { &*(bytes as *const [u8] as *const BStr) }
    }
}
impl core::fmt::Debug for BStr {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(f, "{:?}", String::from_utf8_lossy(&self.0))
    }
}

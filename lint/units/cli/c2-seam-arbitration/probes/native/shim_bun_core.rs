// Stand-in for the two helpers of bun_core::strings that src/lint/tspath.rs calls, with their semantics.
pub mod strings {
    pub fn index_of_char_usize(slice: &[u8], char: u8) -> Option<usize> {
        slice.iter().position(|&b| b == char)
    }
    pub fn split<'a>(s: &'a [u8], delimiter: &'a [u8]) -> impl Iterator<Item = &'a [u8]> {
        let d = delimiter[0];
        s.split(move |&b| b == d)
    }
}

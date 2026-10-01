// Scratch stand-in for bun_core: StackCheck and the byte-string helpers, with the real signatures.
#[derive(Clone, Copy, Default)]
pub struct StackCheck {
    cached_stack_end: usize,
}
impl StackCheck {
    pub fn init() -> Self {
        Self { cached_stack_end: 0 }
    }
    pub fn is_safe_to_recurse(self) -> bool {
        let probe = 0u8;
        (&probe as *const u8 as usize) > self.cached_stack_end
    }
}
pub mod strings {
    pub fn index_of(haystack: &[u8], needle: &[u8]) -> Option<usize> {
        if needle.is_empty() { return Some(0); }
        haystack.windows(needle.len()).position(|w| w == needle)
    }
    pub fn last_index_of(haystack: &[u8], needle: &[u8]) -> Option<usize> {
        if needle.is_empty() { return Some(haystack.len()); }
        haystack.windows(needle.len()).rposition(|w| w == needle)
    }
    pub fn index_of_char(haystack: &[u8], c: u8) -> Option<u32> {
        haystack.iter().position(|b| *b == c).map(|i| i as u32)
    }
    pub fn index_of_char_usize(haystack: &[u8], c: u8) -> Option<usize> {
        haystack.iter().position(|b| *b == c)
    }
    pub fn last_index_of_char(haystack: &[u8], c: u8) -> Option<usize> {
        haystack.iter().rposition(|b| *b == c)
    }
    pub fn contains(haystack: &[u8], needle: &[u8]) -> bool {
        index_of(haystack, needle).is_some()
    }
    pub fn contains_char(haystack: &[u8], c: u8) -> bool {
        haystack.contains(&c)
    }
    pub fn starts_with_char(haystack: &[u8], c: u8) -> bool {
        haystack.first() == Some(&c)
    }
    pub fn ends_with_char(haystack: &[u8], c: u8) -> bool {
        haystack.last() == Some(&c)
    }
    pub fn index_of_any(haystack: &[u8], chars: &[u8]) -> Option<usize> {
        haystack.iter().position(|b| chars.contains(b))
    }
}

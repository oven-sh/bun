// Scratch stand-in for the two things of bun_core that src/typecheck uses.
#[derive(Clone, Copy, Default)]
pub struct StackCheck;
impl StackCheck {
    pub fn init() -> Self { StackCheck }
    pub fn is_safe_to_recurse(&self) -> bool { true }
}
pub mod strings {
    pub fn starts_with_char(s: &[u8], c: u8) -> bool { s.first() == Some(&c) }
    pub fn ends_with_char(s: &[u8], c: u8) -> bool { s.last() == Some(&c) }
    pub fn index_of_any(s: &[u8], chars: &[u8]) -> Option<usize> {
        for (i, b) in s.iter().enumerate() { if chars.iter().any(|c| c == b) { return Some(i); } }
        None
    }
    pub fn index_of_char(s: &[u8], c: u8) -> Option<usize> { index_of_any(s, &[c]) }
    pub fn contains_char(s: &[u8], c: u8) -> bool { index_of_char(s, c).is_some() }
}

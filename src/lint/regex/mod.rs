//! JavaScript's regular expressions.

/// `new RegExp(pattern, flags)`
#[derive(Debug)]
pub struct Regex {}

#[derive(Debug)]
pub struct SyntaxError {
    pub message: String,
    pub offset: u32,
}

impl Regex {
    pub fn new(_pattern: &str, _flags: &str) -> Result<Regex, SyntaxError> {
        Ok(Regex {})
    }

    /// `regex.test(text)`
    pub fn test(&self, _text: &[u8]) -> bool {
        false
    }
}

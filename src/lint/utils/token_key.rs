//! What [`equal_tokens`](super::ast_utils::equal_tokens) compares, as something that can be hashed: to find the equal ones among
//! n ranges takes time in proportion to their text, not n² comparisons.

use crate::ast::File;
use crate::span::Spanned;
use rustc_hash::FxHashMap;

/// Appends a text to `key` that is the same for two ranges of `file` if and only if they consist of the same tokens: of each
/// token its kind, the length of its value and its value. It takes the tokens of the file.
pub fn push_token_key<'a>(file: &'a File<'a>, at: impl Spanned, key: &mut Vec<u8>) {
    for token in file.tokens_in(at) {
        let value = token.decoded_value();
        key.push(token.kind() as u8);
        key.extend_from_slice(&(value.len() as u32).to_le_bytes());
        key.extend_from_slice(&value);
    }
}

/// Numbers ranges of a file: two have the same number if and only if they consist of the same tokens.
#[derive(Default)]
pub struct TokenClasses {
    numbers: FxHashMap<Box<[u8]>, u32>,
    /// Kept for its allocation.
    key: Vec<u8>,
}

impl TokenClasses {
    /// The number of `at`. The first range has 0, and each that is equal to none before it has [`TokenClasses::len`].
    pub fn number_of<'a>(&mut self, file: &'a File<'a>, at: impl Spanned) -> u32 {
        self.key.clear();
        push_token_key(file, at, &mut self.key);
        if let Some(&number) = self.numbers.get(&self.key[..]) {
            return number;
        }
        let number = self.numbers.len() as u32;
        self.numbers.insert(self.key[..].into(), number);
        number
    }

    /// How many numbers are taken.
    #[inline]
    pub fn len(&self) -> usize {
        self.numbers.len()
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.numbers.is_empty()
    }

    pub fn clear(&mut self) {
        self.numbers.clear();
    }
}

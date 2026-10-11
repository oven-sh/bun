//! What [`equal_tokens`](super::ast_utils::equal_tokens) compares, as something that can be hashed: to find the equal ones among
//! n ranges takes time in proportion to their text, not n² comparisons.

use crate::ast::File;
use crate::span::Spanned;

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

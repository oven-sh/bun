//! Scans a file into tokens and comments.

use super::TokenStore;
use crate::ast::File;

pub(super) fn scan(_file: &File) -> TokenStore {
    TokenStore::default()
}

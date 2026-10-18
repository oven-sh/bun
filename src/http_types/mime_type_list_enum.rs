//! Hand-maintained; derived from `mime_type_list.txt`.

/// Compact handle to a known MIME-type string literal.
///
/// Rust idents cannot
/// contain `/`, so we wrap the literal instead and compare by string.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct MimeTypeList(pub &'static str);

impl MimeTypeList {
    /// Const-construct from a MIME-type string literal (used by the `t!` macro).
    #[inline]
    pub const fn from_mime_literal(s: &'static str) -> Self {
        MimeTypeList(s)
    }

    #[inline]
    pub(crate) const fn slice(self) -> &'static [u8] {
        self.0.as_bytes()
    }
}

impl From<MimeTypeList> for &'static str {
    #[inline]
    fn from(v: MimeTypeList) -> Self {
        v.0
    }
}

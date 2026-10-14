use crate::highlight::{Language, Spans};

pub(crate) fn highlight(_code: &[u8], _language: Language, _spans: &mut Spans) {}

/// The value of a `style` attribute: declarations without a rule around them.
pub(crate) fn highlight_declarations(_code: &[u8], _spans: &mut Spans) {}

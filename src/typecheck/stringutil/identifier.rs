// internal/stringutil/identifier.go
use crate::stringutil::identifier_parts_generated::{
    UNICODE_ES_NEXT_IDENTIFIER_PART, UNICODE_ES_NEXT_IDENTIFIER_START,
};
use crate::stringutil::util::unicode;

// IsUnicodeIdentifierStart reports whether ch may begin an ECMAScript identifier, i.e. whether it has the Unicode ID_Start (or Other_ID_Start) property.
pub fn is_unicode_identifier_start(ch: u32) -> bool {
    unicode::is(&UNICODE_ES_NEXT_IDENTIFIER_START, ch)
}

// IsUnicodeIdentifierPart reports whether ch may appear after the first character of an ECMAScript identifier, i.e. whether it has the Unicode ID_Continue (or Other_ID_Continue) property, which also includes ID_Start.
pub fn is_unicode_identifier_part(ch: u32) -> bool {
    unicode::is(&UNICODE_ES_NEXT_IDENTIFIER_PART, ch)
}

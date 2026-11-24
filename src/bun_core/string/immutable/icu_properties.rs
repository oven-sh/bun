//! Unicode properties from ICU, so of the version of Unicode that JavaScriptCore has.

unsafe extern "C" {
    safe fn Bun__isIDStart(code_point: u32) -> bool;
    safe fn Bun__isIDContinue(code_point: u32) -> bool;
}

/// `ID_Start`
#[inline]
pub fn is_id_start(code_point: u32) -> bool {
    match u8::try_from(code_point) {
        Ok(byte) if byte.is_ascii() => byte.is_ascii_alphabetic(),
        _ => Bun__isIDStart(code_point),
    }
}

/// `ID_Continue`
#[inline]
pub fn is_id_continue(code_point: u32) -> bool {
    match u8::try_from(code_point) {
        Ok(byte) if byte.is_ascii() => byte.is_ascii_alphanumeric() || byte == b'_',
        _ => Bun__isIDContinue(code_point),
    }
}

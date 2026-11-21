//! `unicode/uchar.h`

use crate::capi::ffi::{self, UBool, UChar32};
use crate::common::soft_assert::soft_unreachable;
use crate::common::unicode::uchar::UCharDirection;
use crate::common::{emojiprops, ubidi_props, ucase, uchar};
use bun_icu_macros::capi;

type UProperty = i32;
const UCHAR_ID_CONTINUE: UProperty = 15;
const UCHAR_ID_START: UProperty = 16;
const UCHAR_EMOJI_PRESENTATION: UProperty = 58;
const UCHAR_EMOJI_MODIFIER: UProperty = 59;
const UCHAR_EAST_ASIAN_WIDTH: UProperty = 0x1004;

#[capi]
fn u_charType(c: UChar32) -> i8 {
    uchar::u_char_type(c as u32) as i8
}

#[capi]
fn u_isUWhiteSpace(c: UChar32) -> UBool {
    UBool::from(uchar::u_is_u_white_space(c as u32))
}

/// Accepts `UCHAR_ID_START`, `UCHAR_ID_CONTINUE`, `UCHAR_EMOJI_PRESENTATION` and `UCHAR_EMOJI_MODIFIER`.
#[capi]
fn u_hasBinaryProperty(c: UChar32, which: UProperty) -> UBool {
    let c = c as u32;
    UBool::from(match which {
        UCHAR_ID_START => uchar::is_id_start(c),
        UCHAR_ID_CONTINUE => uchar::is_id_continue(c),
        UCHAR_EMOJI_PRESENTATION => ffi::ignore_oom(|| emojiprops::is_emoji_presentation(c)),
        UCHAR_EMOJI_MODIFIER => ffi::ignore_oom(|| emojiprops::is_emoji_modifier(c)),
        _ => {
            soft_unreachable();
            false
        }
    })
}

/// Accepts `UCHAR_EAST_ASIAN_WIDTH`.
#[capi]
fn u_getIntPropertyValue(c: UChar32, which: UProperty) -> i32 {
    if which == UCHAR_EAST_ASIAN_WIDTH {
        return uchar::east_asian_width(c as u32);
    }
    soft_unreachable();
    0
}

#[capi]
fn u_tolower(c: UChar32) -> UChar32 {
    ucase::to_lower(c as u32) as UChar32
}

#[capi]
fn u_toupper(c: UChar32) -> UChar32 {
    ucase::to_upper(c as u32) as UChar32
}

#[capi]
fn u_charDirection(c: UChar32) -> UCharDirection {
    ubidi_props::ubidi_get_class(c as u32)
}

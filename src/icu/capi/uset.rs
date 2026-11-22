//! `unicode/uset.h`

use crate::capi::ffi::{self, Dest, ErrorCode, Out, UChar, UChar32, to_int32};
use crate::common::memory::try_box;
use crate::common::uniset::UnicodeSet;
use crate::common::utypes::*;
use bun_icu_macros::capi;

pub(crate) type USet = UnicodeSet;

#[capi]
fn uset_openEmpty() -> Option<Box<USet>> {
    ffi::on_oom(None, || try_box(UnicodeSet::new()).ok())
}

#[capi]
fn uset_close(set: Option<Box<USet>>) {
    drop(set);
}

#[capi]
fn uset_getItemCount(set: Option<&USet>) -> i32 {
    set.map_or(0, |set| to_int32(set.ranges().len() + set.strings().len()))
}

#[capi]
fn uset_getItem(
    set: Option<&USet>,
    item_index: i32,
    start: Out<UChar32>,
    end: Out<UChar32>,
    (str, _): Dest<UChar>,
    ec: ErrorCode,
) -> i32 {
    ec.run_no_alloc(0, |ec| {
        let (Ok(index), Some(set)) = (usize::try_from(item_index), set) else {
            *ec = U_ILLEGAL_ARGUMENT_ERROR;
            return Ok(-1);
        };
        if let Some(range) = set.ranges().nth(index) {
            if start.is_null() || end.is_null() {
                *ec = U_ILLEGAL_ARGUMENT_ERROR;
                return Ok(-1);
            }
            start.set(*range.start() as i32);
            end.set(*range.end() as i32);
            return Ok(0);
        }
        let Some(string) = set.strings().get(index - set.ranges().len()) else {
            *ec = U_INDEX_OUTOFBOUNDS_ERROR;
            return Ok(-1);
        };
        Ok(str.extract_to(string, ec))
    })
}

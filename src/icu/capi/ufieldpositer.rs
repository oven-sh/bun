//! `unicode/ufieldpositer.h`

use crate::capi::ffi::{ErrorCode, Out};
use crate::i18n::fphdlimp::FieldPositionIterator;
use bun_icu_macros::capi;

pub(crate) type UFieldPositionIterator = FieldPositionIterator;

#[capi]
fn ufieldpositer_open(status: ErrorCode) -> Option<Box<UFieldPositionIterator>> {
    status.open(|| Ok(FieldPositionIterator::default()))
}

#[capi]
fn ufieldpositer_close(fpositer: Option<Box<UFieldPositionIterator>>) {
    drop(fpositer);
}

#[capi]
fn ufieldpositer_next(
    fpositer: Option<&mut UFieldPositionIterator>,
    begin_index: Out<i32>,
    end_index: Out<i32>,
) -> i32 {
    let Some(fp) = fpositer.and_then(Iterator::next) else {
        return -1;
    };
    begin_index.set(fp.start);
    end_index.set(fp.limit);
    fp.field
}

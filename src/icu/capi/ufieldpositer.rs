//! `unicode/ufieldpositer.h`

use crate::capi::ffi::{CallerMem, ErrorCode, LocalHandle, Mut, Out, Owned};
use crate::i18n::fphdlimp::FieldPositionIterator;
use bun_icu_macros::capi;

pub(crate) type UFieldPositionIterator = FieldPositionIterator;

#[capi]
fn ufieldpositer_open(status: ErrorCode) -> *mut UFieldPositionIterator {
    status.open(|_, _| LocalHandle::boxed(FieldPositionIterator::default()))
}

#[capi]
fn ufieldpositer_close(fpositer: Owned<UFieldPositionIterator>) {
    fpositer.close()
}

#[capi]
fn ufieldpositer_next(
    cx: &mut CallerMem,
    fpositer: Mut<UFieldPositionIterator>,
    begin_index: Out<i32>,
    end_index: Out<i32>,
) -> i32 {
    let Some(fp) = fpositer.get_mut().ok().and_then(Iterator::next) else {
        return -1;
    };
    cx.store(begin_index, fp.start);
    cx.store(end_index, fp.limit);
    fp.field
}

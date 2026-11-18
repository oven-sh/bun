use bun_engine_vm::{Cx, JsResult, Thrown};

use crate::{ErrorKind, InputError};

#[cold]
pub(super) fn throw<'a>(cx: &Cx, error: impl Into<InputError<'a>>) -> Thrown {
    throw_input_error(cx, &error.into())
}

#[cold]
#[inline(never)]
fn throw_input_error(cx: &Cx, error: &InputError<'_>) -> Thrown {
    match error.kind() {
        ErrorKind::Range => cx.throw_range_error(error.message()),
        ErrorKind::Type => cx.throw_type_error(error.message()),
    }
}

pub(super) trait OrThrow<T> {
    fn or_throw(self, cx: &Cx) -> JsResult<T>;
}

impl<'a, T, E: Into<InputError<'a>>> OrThrow<T> for Result<T, E> {
    #[inline(always)]
    fn or_throw(self, cx: &Cx) -> JsResult<T> {
        self.map_err(|error| throw(cx, error))
    }
}

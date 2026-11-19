use bun_jsc::{JSGlobalObject, JSValue, SystemError};
use bun_telemetry::db::DbError;
use bun_telemetry::{Record, StatusCode};

use crate::engine::{self, ErrorDescription};

/// How an operation ended.
pub trait Outcome {
    fn record(self, record: &mut Record);
}

impl<E: Outcome> Outcome for Option<E> {
    fn record(self, record: &mut Record) {
        if let Some(error) = self {
            error.record(record);
        }
    }
}

impl<'a, T, E> Outcome for &'a Result<T, E>
where
    &'a E: Outcome,
{
    fn record(self, record: &mut Record) {
        self.as_ref().err().record(record);
    }
}

impl Outcome for &bun_sys::Error {
    fn record(self, record: &mut Record) {
        record.fail_with_code(self.name(), self.msg().unwrap_or_default());
    }
}

impl Outcome for &SystemError {
    fn record(self, record: &mut Record) {
        record.fail_with_code(&self.code.to_utf8(), &self.message.to_utf8());
    }
}

impl Outcome for DbError<'_> {
    fn record(self, record: &mut Record) {
        DbError::record(&self, record);
    }
}

/// An error code, and a message that may be empty.
#[derive(Clone, Copy)]
pub struct Failed<'a>(pub &'a [u8], pub &'a [u8]);

impl Outcome for Failed<'_> {
    fn record(self, record: &mut Record) {
        record.fail_with_code(self.0, self.1);
    }
}

impl Outcome for &ErrorDescription {
    fn record(self, record: &mut Record) {
        if self.is_nullish {
            record.set_status(StatusCode::Error, b"");
        } else {
            self.with(|e| record.fail(e));
        }
    }
}

/// A thrown value or its `Exception`, on its way to script. No getter of it runs.
pub struct Thrown<'a>(pub &'a JSGlobalObject, pub JSValue);

impl Outcome for Thrown<'_> {
    fn record(self, record: &mut Record) {
        engine::describe_passing_error(self.0, self.1).record(record);
    }
}

/// The reason of an `AbortSignal`. semconv: what the caller cancels has not failed, unless it ran out of time.
pub struct Aborted<'a>(pub &'a JSGlobalObject, pub JSValue);

impl Outcome for Aborted<'_> {
    fn record(self, record: &mut Record) {
        let reason = engine::describe_passing_error(self.0, self.1);
        if reason.ty.eq_ascii(b"TimeoutError") {
            reason.record(record);
        }
    }
}

/// The operation has failed if an exception is pending, which stays so.
pub struct PendingException<'a>(pub &'a JSGlobalObject);

impl Outcome for PendingException<'_> {
    fn record(self, record: &mut Record) {
        engine::describe_pending_exception(self.0)
            .as_ref()
            .record(record);
    }
}

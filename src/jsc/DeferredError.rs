use crate::node::ErrorCode;
use crate::{JSGlobalObject, JSValue};
use bun_str::{String as BunString, ZigString};

// Error's cannot be created off of the main thread. So we use this to store the
// information until its ready to be materialized later.
pub struct DeferredError {
    pub kind: Kind,
    pub code: ErrorCode,
    pub msg: BunString,
}

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum Kind {
    Plainerror,
    Typeerror,
    Rangeerror,
}

impl DeferredError {
    pub fn from(kind: Kind, code: ErrorCode, args: core::fmt::Arguments<'_>) -> DeferredError {
        DeferredError {
            kind,
            code,
            // bun.handleOom dropped: Rust allocation aborts on OOM by default.
            msg: BunString::create_format(args),
        }
    }

    pub fn to_error(&self, global: &JSGlobalObject) -> JSValue {
        let err = match self.kind {
            Kind::Plainerror => self.msg.to_error_instance(global),
            Kind::Typeerror => self.msg.to_type_error_instance(global),
            Kind::Rangeerror => self.msg.to_range_error_instance(global),
        };
        err.put(
            global,
            ZigString::static_(b"code"),
            ZigString::init(<&'static str>::from(self.code).as_bytes()).to_js(global),
        );
        err
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/DeferredError.zig (34 lines)
//   confidence: high
//   todos:      0
//   notes:      `from` collapses (comptime fmt, args: anytype) into fmt::Arguments; bun_str::String to_*_instance methods need StringJsc ext trait in this crate
// ──────────────────────────────────────────────────────────────────────────

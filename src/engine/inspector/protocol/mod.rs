//! The form of messages: JSON-RPC 2.0, without its version member.

mod json;
mod request;

pub(crate) use json::{Json, Object, object};
pub(crate) use request::{Error, ErrorCode, Outcome, Params, Request, event, response};

//! The standard library.

#![forbid(unsafe_code)]
#![feature(adt_const_params, macro_metavar_expr_concat, negative_impls)]
#![allow(improper_ctypes_definitions)]

mod arrays;
mod buffers;
mod collections;
mod control;
mod define;
mod functions;
mod fundamental;
mod js;
mod numbers;
mod realm;
mod text;
mod watchpoints;

pub use js::builtin_source;
pub use realm::{initialize_realm, initialize_slot};
pub use watchpoints::watchpoint_conditions;

/// What nearly every module of this crate uses.
mod prelude {
    pub(crate) use bun_engine_macros::{cell, native_abi};
    pub(crate) use bun_engine_text::{names, symbols};
    pub(crate) use bun_engine_vm::{
        CallFrame, Cx, Gc, InternalFunction, Intrinsic, JsObject, JsResult, JsString, Shape,
        ShapeSpec, StaticProperty, Value, static_table,
    };

    pub(crate) use crate::define::{define_constructor, define_object};
}

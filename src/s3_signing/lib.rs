#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
#![warn(unused_must_use)]
// AUTOGEN: mod declarations only — real exports added in B-1.
pub mod error;
pub mod acl;
pub mod storage_class;

pub mod credentials;

pub use acl::ACL;
pub use storage_class::StorageClass;
pub use error::{S3Error, ErrorCodeAndMessage};
pub use credentials::*;
